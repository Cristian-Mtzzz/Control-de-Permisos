using ControlPermisos.Api.Services;
using Microsoft.Extensions.Caching.Memory;

namespace ControlPermisos.Api.Tests;

// Piezas del inicio de sesión que no necesitan la base: nombres de dominio, duración de la
// sesión, contraseñas y límites de intentos.
public sealed class AuthTests
{
    [Theory]
    [InlineData(@"BA\Juan.Perez")]
    [InlineData("juan.perez@ihss.hn")]
    [InlineData(" Juan.Perez ")]
    public void ElUsuarioDeDominioSeNormaliza(string escrito)
    {
        Assert.Equal("juan.perez", AuthService.NormalizeDomainUserName(escrito));
    }

    [Fact]
    public void LaSesionVenceAlCumplirSuDuracionMaxima()
    {
        var ahora = new DateTimeOffset(2026, 10, 28, 15, 0, 0, TimeSpan.Zero);
        var maxima = TimeSpan.FromHours(10);

        Assert.True(AuthService.SesionVigente(ahora.AddHours(-1), ahora, maxima));
        Assert.True(AuthService.SesionVigente(ahora.AddHours(-10).AddSeconds(1), ahora, maxima));
        Assert.False(AuthService.SesionVigente(ahora.AddHours(-10), ahora, maxima));
        // Un inicio en el futuro no es válido: no puede alargar la sesión.
        Assert.False(AuthService.SesionVigente(ahora.AddMinutes(5), ahora, maxima));
    }

    [Fact]
    public void LaContrasenaSeGuardaConBcryptYSeVerifica()
    {
        var hash = PasswordHashing.Hash("Clave.Segura1");
        Assert.True(PasswordHashing.IsBcrypt(hash));
        Assert.True(PasswordHashing.Verify("Clave.Segura1", hash));
        Assert.False(PasswordHashing.Verify("otra", hash));
    }

    [Fact]
    public void ElHashAntiguoNoEsBcryptYNoRompeLaVerificacion()
    {
        Assert.False(PasswordHashing.IsBcrypt("12345678901234567890"));
        Assert.False(PasswordHashing.IsBcrypt(null));
        Assert.False(PasswordHashing.Verify("1234", "12345678901234567890"));
    }

    [Fact]
    public void ElUsuarioSeBloqueaTrasLosFallosPermitidosSinImportarComoSeEscriba()
    {
        var limiter = new LoginAttemptLimiter(new MemoryCache(new MemoryCacheOptions()));
        var limits = new LoginLimits(MaxFailedAttemptsPerUser: 3, LockoutMinutes: 5, AttemptsPerMinutePerIp: 10);

        limiter.RegisterFailure("juan.perez", limits);
        limiter.RegisterFailure(@"BA\Juan.Perez", limits);
        Assert.Null(limiter.GetRemainingLockout("juan.perez"));

        limiter.RegisterFailure("juan.perez@ihss.hn", limits);
        var restante = limiter.GetRemainingLockout("JUAN.PEREZ");
        Assert.NotNull(restante);
        Assert.InRange(restante.Value, TimeSpan.FromMinutes(4), TimeSpan.FromMinutes(5));

        limiter.Reset("juan.perez");
        Assert.Null(limiter.GetRemainingLockout("juan.perez"));
    }

    [Fact]
    public void UnEquipoTieneUnMaximoDeIntentosPorMinuto()
    {
        var limiter = new LoginAttemptLimiter(new MemoryCache(new MemoryCacheOptions()));
        var limits = new LoginLimits(5, 5, AttemptsPerMinutePerIp: 3);

        for (var intento = 0; intento < 3; intento++) Assert.True(limiter.TryRegisterIpAttempt("10.1.1.1", limits));
        Assert.False(limiter.TryRegisterIpAttempt("10.1.1.1", limits));
        Assert.True(limiter.TryRegisterIpAttempt("10.1.1.2", limits));
    }
}
