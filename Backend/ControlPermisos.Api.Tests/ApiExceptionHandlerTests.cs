using System.Text.Json;
using ControlPermisos.Api.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace ControlPermisos.Api.Tests;

// Cada excepción no controlada se convierte en { Message } con su código HTTP.
public sealed class ApiExceptionHandlerTests
{
    private static async Task<(int Status, string Body)> Manejar(Exception exception, HttpContext? context = null)
    {
        context ??= new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        var handled = await new ApiExceptionHandler(NullLogger<ApiExceptionHandler>.Instance)
            .TryHandleAsync(context, exception, default);
        Assert.True(handled);
        context.Response.Body.Position = 0;
        return (context.Response.StatusCode, await new StreamReader(context.Response.Body).ReadToEndAsync());
    }

    private static string Mensaje(string body) =>
        JsonSerializer.Deserialize<Dictionary<string, string>>(body)!.Values.Single();

    [Fact]
    public async Task AccesoNegadoEs403ConSuMotivo()
    {
        var (status, body) = await Manejar(new UnauthorizedAccessException("Tu usuario es de consulta."));
        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.Equal("Tu usuario es de consulta.", Mensaje(body));
    }

    [Fact]
    public async Task ReglaDeNegocioEs400ConSuMensaje()
    {
        var (status, body) = await Manejar(new ArgumentException("El rango elegido no tiene días hábiles."));
        Assert.Equal(StatusCodes.Status400BadRequest, status);
        Assert.Equal("El rango elegido no tiene días hábiles.", Mensaje(body));
    }

    [Theory]
    [InlineData(typeof(ArgumentNullException))]
    [InlineData(typeof(InvalidOperationException))]
    public async Task ErrorInternoEs500SinDetalles(Type tipo)
    {
        var (status, body) = await Manejar((Exception)Activator.CreateInstance(tipo, "detalle interno")!);
        Assert.Equal(StatusCodes.Status500InternalServerError, status);
        Assert.DoesNotContain("detalle interno", Mensaje(body));
    }

    [Fact]
    public async Task SolicitudCanceladaPorElClienteNoEscribeRespuesta()
    {
        using var cancelada = new CancellationTokenSource();
        cancelada.Cancel();
        var context = new DefaultHttpContext { RequestAborted = cancelada.Token };

        var (status, body) = await Manejar(new OperationCanceledException(), context);
        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.Empty(body);
    }
}
