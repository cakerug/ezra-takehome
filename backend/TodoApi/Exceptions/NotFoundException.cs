namespace TodoApi.Exceptions;

/// <summary>
/// Thrown when a requested resource (e.g. a Project or TaskItem) does not exist.
/// Mapped by <see cref="TodoApi.Middleware.ExceptionHandlingMiddleware"/> to a 404 response.
/// </summary>
public class NotFoundException : Exception
{
    public NotFoundException(string message) : base(message)
    {
    }
}
