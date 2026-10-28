using ControlPermisos.Api.Controllers;
using ControlPermisos.Api.Models;
using ControlPermisos.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace ControlPermisos.Api.Tests;

// El login responde igual a una contraseña incorrecta y a una cuenta sin acceso, y los dos casos
// cuentan para el bloqueo: así no confirma que una contraseña es correcta.
public sealed class AuthControllerTests
{
    private static readonly LoginRequestDto Request = new() { UserName = "juan.perez", Password = "secreta" };

    private static AuthController Controller(Func<LoginResponseDto?> login)
    {
        var cache = new MemoryCache(new MemoryCacheOptions());
        // Límites ya en caché: el proveedor no consulta LOGIN_CONFIG.
        cache.Set(LoginLimitsProvider.CacheKey, new LoginLimits(MaxFailedAttemptsPerUser: 3, LockoutMinutes: 5, AttemptsPerMinutePerIp: 100));
        var limitsProvider = new LoginLimitsProvider(
            new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            cache,
            new ConfigurationBuilder().Build(),
            NullLogger<LoginLimitsProvider>.Instance);
        return new AuthController(new FakeAuthService(login), new LoginAttemptLimiter(cache), limitsProvider, NullLogger<AuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    private static (int? Status, object? Message) Respuesta(ActionResult<LoginResponseDto> result)
    {
        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        return (objectResult.StatusCode, objectResult.Value?.GetType().GetProperty("Message")?.GetValue(objectResult.Value));
    }

    [Fact]
    public async Task CuentaSinAccesoRespondeIgualQueCredencialesIncorrectas()
    {
        var incorrecta = Respuesta(await Controller(() => null).AuthenticateUser(Request, default));
        var sinAcceso = Respuesta(await Controller(() => throw new UnauthorizedAccessException("Sin área asignada."))
            .AuthenticateUser(Request, default));

        Assert.Equal(StatusCodes.Status401Unauthorized, incorrecta.Status);
        Assert.Equal(incorrecta, sinAcceso);
        Assert.Equal(AuthController.LoginRechazado, sinAcceso.Message);
    }

    [Fact]
    public async Task CuentaSinAccesoCuentaComoFalloParaElBloqueo()
    {
        var llamadas = 0;
        var controller = Controller(() => { llamadas++; throw new UnauthorizedAccessException("Sin área asignada."); });

        for (var intento = 0; intento < 3; intento++) await controller.AuthenticateUser(Request, default);
        var bloqueado = Respuesta(await controller.AuthenticateUser(Request, default));

        Assert.Equal(StatusCodes.Status429TooManyRequests, bloqueado.Status);
        Assert.Equal(3, llamadas);
    }

    [Fact]
    public async Task LoginCorrectoReiniciaLosFallos()
    {
        var correcto = false;
        var respuesta = new LoginResponseDto("token", new UserResponseDto(1, "juan.perez", "Juan", PermisoValores.NivelJefe), false);
        var controller = Controller(() => correcto ? respuesta : null);

        for (var intento = 0; intento < 2; intento++) await controller.AuthenticateUser(Request, default);
        correcto = true;
        Assert.IsType<OkObjectResult>((await controller.AuthenticateUser(Request, default)).Result);
        correcto = false;
        for (var intento = 0; intento < 2; intento++) await controller.AuthenticateUser(Request, default);

        Assert.Equal(StatusCodes.Status401Unauthorized, Respuesta(await controller.AuthenticateUser(Request, default)).Status);
    }

    [Fact]
    public async Task LaContrasenaNuevaDebeSerDistintaDeLaInicial()
    {
        var controller = Controller(() => null);
        controller.ControllerContext.HttpContext.User = new System.Security.Claims.ClaimsPrincipal(
            new System.Security.Claims.ClaimsIdentity([new System.Security.Claims.Claim("sub", "7")], "Test"));

        var result = await controller.ChangeInitialPassword(
            new ChangePasswordDto { CurrentPassword = "123456", NewPassword = "123456" }, default);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("La nueva contraseña debe ser distinta de la actual.",
            badRequest.Value?.GetType().GetProperty("Message")?.GetValue(badRequest.Value));
    }

    private sealed class FakeAuthService(Func<LoginResponseDto?> login) : IAuthService
    {
        public Task<LoginResponseDto?> AuthenticateUser(LoginRequestDto loginRequest, CancellationToken cancellationToken) =>
            Task.FromResult(login());

        public Task<string?> RefreshToken(int userId, DateTimeOffset? sessionStart, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> ChangeInitialPassword(int userId, ChangePasswordDto request, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
