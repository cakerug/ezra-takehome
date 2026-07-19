namespace TodoApi.Exceptions;

/// <summary>
/// Thrown when an operation is disallowed by a business rule even though the request is
/// otherwise well-formed.
/// Mapped by <see cref="TodoApi.Middleware.ExceptionHandlingMiddleware"/> to a 403 response.
/// </summary>
public class ForbiddenOperationException(string message) : Exception(message);
