using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using ControlPermisos.Api.Data;
using ControlPermisos.Api.Infrastructure;
using ControlPermisos.Api.Services;
using ControlPermisos.Api.Swagger;

// Punto de entrada de la API del Control de permisos. Aquí se conectan configuración, Oracle,
// servicios, autenticación JWT, CORS y el pipeline HTTP que atiende al frontend.
var builder = WebApplication.CreateBuilder(args);

const string AngularCorsPolicy = "AngularCorsPolicy";

// Sin la cabecera "Server: Kestrel" las respuestas no anuncian el servidor que las atiende.
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);

// Las respuestas JSON conservan los nombres en PascalCase de los DTO (IdPermiso, Message...),
// que es el formato que usan los modelos del frontend.
builder.Services.AddControllers()
    .AddJsonOptions(options => options.JsonSerializerOptions.PropertyNamingPolicy = null);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = null);
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "ControlPermisos API",
        Version = "v1",
    });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Ingresa el token JWT obtenido desde /api/auth/login.",
    });
    options.OperationFilter<AuthorizeCheckOperationFilter>();
});

// La cadena de conexión completa está configurada directamente en appsettings.json. Es la misma
// base del inventario: comparten USUARIOS, EMPLEADOS_IHSS, DEPARTAMENTO_IHSS y LOGIN_CONFIG.
var oracleConnection = builder.Configuration.GetConnectionString("OracleConnection");
if (string.IsNullOrWhiteSpace(oracleConnection))
{
    throw new InvalidOperationException("Falta ConnectionStrings:OracleConnection en appsettings.json.");
}

builder.Services.AddDbContext<PermisosDbContext>(options => options.UseOracle(oracleConnection));
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IPermisoService, PermisoService>();
builder.Services.AddScoped<IPermisoAreaService, PermisoAreaService>();
builder.Services.AddLoginProtection();

var allowedOrigins = new List<string>
{
    "http://localhost:4300",
    "http://127.0.0.1:4300",
    "http://10.1.22.55",
};

var frontendBaseUrl = builder.Configuration["Hosting:FrontendBaseUrl"];
if (!string.IsNullOrWhiteSpace(frontendBaseUrl)
    && Uri.TryCreate(frontendBaseUrl, UriKind.Absolute, out var frontendUri)
    && (frontendUri.Scheme == Uri.UriSchemeHttp || frontendUri.Scheme == Uri.UriSchemeHttps))
{
    allowedOrigins.Add(frontendUri.GetLeftPart(UriPartial.Authority));
}

var apiBaseUrl = builder.Configuration["Hosting:ApiBaseUrl"];
if (!string.IsNullOrWhiteSpace(apiBaseUrl)
    && Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var apiUri)
    && (apiUri.Scheme == Uri.UriSchemeHttp || apiUri.Scheme == Uri.UriSchemeHttps))
{
    allowedOrigins.Add(apiUri.GetLeftPart(UriPartial.Authority));
}

// Validación del JWT. La clave, el emisor y la audiencia son propios de este sistema: un token
// del inventario no sirve aquí ni al revés.
var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey))
{
    throw new InvalidOperationException("Falta Jwt:Key en appsettings.json.");
}

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "ControlPermisos.Api";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "ControlPermisos.Web";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero,
        };
    });
// La política por defecto exige haber cambiado la contraseña inicial. El nivel de cada usuario
// (administrador, administrador de departamento, jefe o consulta) no va en el token: la API lo
// lee de la base en cada solicitud (PermisoAreaService.GetAlcance).
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("PasswordChange", policy => policy.RequireAuthenticatedUser());
    options.DefaultPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .RequireAssertion(context => !context.User.HasClaim("must_change_password", "true"))
        .Build();
});
builder.Services.AddCors(options => options.AddPolicy(AngularCorsPolicy, policy =>
    policy.WithOrigins(allowedOrigins.Distinct().ToArray())
        .AllowAnyHeader()
        .AllowAnyMethod()));

// Con Hosting:RequireHttps = true la API redirige HTTP a HTTPS y envía HSTS. Se activa
// junto con la regla "Forzar HTTPS" del web.config del frontend, cuando IIS ya tenga certificado.
var requireHttps = builder.Configuration.GetValue("Hosting:RequireHttps", false);
if (requireHttps)
{
    builder.Services.AddHsts(options => options.MaxAge = TimeSpan.FromDays(365));
}

var app = builder.Build();

// Convierte cualquier excepción no controlada en una respuesta { Message } con su código HTTP.
app.UseExceptionHandler();

// Soporte para subaplicaciones o directorios virtuales en IIS (ej. /ApiControlPermisos).
if (!string.IsNullOrWhiteSpace(apiBaseUrl)
    && Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var configuredApiUri))
{
    var pathBase = configuredApiUri.AbsolutePath.TrimEnd('/');
    if (pathBase.EndsWith("/api", StringComparison.OrdinalIgnoreCase))
    {
        pathBase = pathBase[..^4];
    }

    if (!string.IsNullOrWhiteSpace(pathBase) && pathBase != "/")
    {
        app.UsePathBase(pathBase);
    }
}

app.UseSecurityHeaders();
if (requireHttps)
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

// La documentación también está disponible en despliegues: /swagger y /swagger/v1/swagger.json.
app.UseSwagger();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("./v1/swagger.json", "ControlPermisos API v1");
    options.RoutePrefix = "swagger";
});

// El orden garantiza CORS, autenticación y autorización antes de ejecutar controladores.
app.UseCors(AngularCorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapGet("/", () => Results.Redirect("swagger"));
app.MapGet("/api", () => Results.Ok(new
{
    status = "ok",
    service = "ControlPermisos.Api",
    serverTime = DateTime.UtcNow,
}));

app.Run();
