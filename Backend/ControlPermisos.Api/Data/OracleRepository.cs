using System.Data;
using System.Data.Common;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Oracle.ManagedDataAccess.Client;

namespace ControlPermisos.Api.Data;

// Base común de los servicios que ejecutan SQL directo sobre Oracle. Centraliza la
// apertura/cierre de la conexión compartida de EF Core, la creación de comandos con
// parámetros por nombre, las transacciones y la lectura de columnas.
public abstract class OracleRepository(PermisosDbContext dbContext)
{
    // Segundos que se espera un bloqueo de tabla antes de fallar con ORA-30006.
    private const int TableLockWaitSeconds = 10;

    protected PermisosDbContext DbContext { get; } = dbContext;

    protected async Task<IReadOnlyList<T>> ReadList<T>(
        string sql,
        Func<DbDataReader, T> mapper,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await DbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = CreateCommand(DbContext.Database.GetDbConnection(), null, sql, parameters);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var result = new List<T>();
            while (await reader.ReadAsync(cancellationToken)) result.Add(mapper(reader));
            return result;
        }
        finally
        {
            await DbContext.Database.CloseConnectionAsync();
        }
    }

    // Ejecuta una sentencia fuera de transacción y devuelve las filas afectadas.
    protected async Task<int> Execute(
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await DbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            return await Execute(DbContext.Database.GetDbConnection(), null, sql, cancellationToken, parameters);
        }
        finally
        {
            await DbContext.Database.CloseConnectionAsync();
        }
    }

    // Ejecuta la operación dentro de una transacción; si algo falla se revierte completa.
    protected async Task<T> InTransaction<T>(
        Func<DbConnection, DbTransaction, Task<T>> operation,
        CancellationToken cancellationToken)
    {
        await DbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            var connection = DbContext.Database.GetDbConnection();
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            try
            {
                var result = await operation(connection, transaction);
                await transaction.CommitAsync(cancellationToken);
                return result;
            }
            catch
            {
                await transaction.RollbackAsync(CancellationToken.None);
                throw;
            }
        }
        finally
        {
            await DbContext.Database.CloseConnectionAsync();
        }
    }

    protected Task InTransaction(
        Func<DbConnection, DbTransaction, Task> operation,
        CancellationToken cancellationToken) =>
        InTransaction<bool>(async (connection, transaction) =>
        {
            await operation(connection, transaction);
            return true;
        }, cancellationToken);

    protected static async Task<int> Execute(
        DbConnection connection,
        DbTransaction? transaction,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await using var command = CreateCommand(connection, transaction, sql, parameters);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    protected static async Task<bool> Exists(
        DbConnection connection,
        DbTransaction? transaction,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await using var command = CreateCommand(connection, transaction, sql, parameters);
        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    protected static async Task<T> GetScalar<T>(
        DbConnection connection,
        DbTransaction? transaction,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await using var command = CreateCommand(connection, transaction, sql, parameters);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        if (result is DBNull or null) return default!;

        var targetType = Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T);
        return (T)Convert.ChangeType(result, targetType, CultureInfo.InvariantCulture);
    }

    // Calcula el siguiente identificador con MAX + 1 de forma segura: bloquea la tabla
    // hasta el commit para que dos solicitudes simultáneas no obtengan el mismo valor.
    // Debe llamarse dentro de InTransaction. Tabla y columna son constantes internas.
    protected static async Task<int> NextId(
        DbConnection connection,
        DbTransaction transaction,
        string table,
        string idColumn,
        CancellationToken cancellationToken)
    {
        await Execute(connection, transaction,
            $"LOCK TABLE {table} IN EXCLUSIVE MODE WAIT {TableLockWaitSeconds}", cancellationToken);
        return await GetScalar<int>(connection, transaction,
            $"SELECT NVL(MAX({idColumn}), 0) + 1 FROM {table}", cancellationToken);
    }

    // Lectura dentro de una transacción abierta (ReadList abre su propia conexión).
    protected static async Task<List<T>> ReadRows<T>(
        DbConnection connection,
        DbTransaction transaction,
        string sql,
        Func<DbDataReader, T> mapper,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await using var command = CreateCommand(connection, transaction, sql, parameters);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<T>();
        while (await reader.ReadAsync(cancellationToken)) rows.Add(mapper(reader));
        return rows;
    }

    protected static DbCommand CreateCommand(
        DbConnection connection,
        DbTransaction? transaction,
        string sql,
        params (string Name, object? Value)[] parameters)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = transaction;
        if (command is OracleCommand oracleCommand)
        {
            oracleCommand.BindByName = true;
        }

        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.DbType = value switch
            {
                int => DbType.Int32,
                long => DbType.Int64,
                decimal => DbType.Decimal,
                DateTime => DbType.DateTime,
                _ => DbType.String,
            };
            parameter.Value = value ?? DBNull.Value;
            command.Parameters.Add(parameter);
        }

        return command;
    }

    protected static string ReadString(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? string.Empty : Convert.ToString(reader.GetValue(ordinal)) ?? string.Empty;
    }

    protected static string? ReadNullableString(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : Convert.ToString(reader.GetValue(ordinal));
    }

    protected static int ReadInt(DbDataReader reader, string column) =>
        Convert.ToInt32(reader.GetValue(reader.GetOrdinal(column)));

    protected static int? ReadNullableInt(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : Convert.ToInt32(reader.GetValue(ordinal));
    }

    protected static DateTime? ReadNullableDate(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : Convert.ToDateTime(reader.GetValue(ordinal));
    }
}
