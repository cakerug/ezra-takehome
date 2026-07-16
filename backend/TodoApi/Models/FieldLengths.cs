namespace TodoApi.Models;

/// <summary>
/// Maximum lengths for user-supplied text fields.
///
/// Each value is referenced from two places that enforce it independently: the request DTOs in
/// <c>Dtos/</c> (reject overlong input with a 400, and publish the limit to the OpenAPI doc the
/// frontend client is generated from) and <see cref="Data.AppDbContext"/> (sizes the column).
/// Sharing a constant keeps those two from drifting apart, which would otherwise be silent:
/// SQLite ignores column lengths entirely, so the DTO limit is the only one with teeth today.
/// The EF limit only starts rejecting values on a provider that honours it, such as Postgres.
///
/// Fields keep their own constant even where the values currently match, since an API's input
/// limit and a column's width are separate policies that are free to diverge.
/// </summary>
public static class FieldLengths
{
    public const int ProjectName = 200;

    public const int TaskTitle = 200;

    public const int TaskDescription = 2000;
}
