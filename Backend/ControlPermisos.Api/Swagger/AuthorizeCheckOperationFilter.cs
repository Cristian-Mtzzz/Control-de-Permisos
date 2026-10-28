using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace ControlPermisos.Api.Swagger;

internal sealed class AuthorizeCheckOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var method = context.MethodInfo;
        var controller = method.DeclaringType;

        if (method.IsDefined(typeof(AllowAnonymousAttribute), inherit: true)
            || controller?.IsDefined(typeof(AllowAnonymousAttribute), inherit: true) == true)
        {
            return;
        }

        if (!method.IsDefined(typeof(AuthorizeAttribute), inherit: true)
            && controller?.IsDefined(typeof(AuthorizeAttribute), inherit: true) != true)
        {
            return;
        }

        operation.Security.Add(new OpenApiSecurityRequirement
        {
            [new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer",
                },
            }] = Array.Empty<string>(),
        });
    }
}
