namespace TodoApi.Exceptions;

/// <summary>
/// Thrown when an operation is disallowed by a business rule even though the request is
/// otherwise well-formed (e.g. attempting to delete the built-in Inbox project in a later unit).
/// Mapped by <see cref="TodoApi.Middleware.ExceptionHandlingMiddleware"/> to a 403 response.
/// </summary>
public class ForbiddenOperationException : Exception
{
    public ForbiddenOperationException(string message) : base(message)
    {
    }
}
