namespace ControlPermisos.Api.Services;

// Hash de contraseñas de usuarios locales con BCrypt (sal aleatoria y costo ajustable).
// Las contraseñas antiguas se guardaban con ORA_HASH; esas se validan en Oracle y se
// reemplazan por BCrypt la próxima vez que el usuario inicia sesión.
public static class PasswordHashing
{
    // 2^11 rondas: unos cien milisegundos por verificación en el servidor.
    private const int WorkFactor = 11;

    // Hash válido que no corresponde a ninguna contraseña real. Se verifica cuando el usuario
    // no existe para que la respuesta tarde lo mismo y no revele qué usuarios existen.
    private static readonly string DummyHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString(), WorkFactor);

    public static string Hash(string password) => BCrypt.Net.BCrypt.HashPassword(password, WorkFactor);

    // Los hash de BCrypt empiezan con "$2"; los de ORA_HASH son solo dígitos.
    public static bool IsBcrypt(string? storedHash) =>
        !string.IsNullOrEmpty(storedHash) && storedHash.StartsWith("$2", StringComparison.Ordinal);

    public static bool Verify(string password, string storedHash)
    {
        try
        {
            return BCrypt.Net.BCrypt.Verify(password, storedHash);
        }
        catch (BCrypt.Net.SaltParseException)
        {
            return false;
        }
    }

    public static void SimulateVerify(string password) => Verify(password, DummyHash);
}
