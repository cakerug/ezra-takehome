namespace TodoApi.Exceptions;

/// <summary>
/// Thrown when a request fails field-level validation (e.g. a required field is missing, or a
/// text field exceeds its max length). Mapped by
/// <see cref="TodoApi.Middleware.ExceptionHandlingMiddleware"/> to a 400 response whose
/// ProblemDetails body names the offending field(s), mirroring ASP.NET Core's built-in
/// validation problem details shape.
/// </summary>
public class ValidationException : Exception
{
    /// <summary>
    /// Maps field name to the list of error messages for that field, matching the shape used by
    /// ASP.NET Core's built-in <c>ValidationProblemDetails.Errors</c>.
    /// </summary>
    public IDictionary<string, string[]> Errors { get; }

    public ValidationException(string fieldName, string message)
        : base(message)
    {
        Errors = new Dictionary<string, string[]>
        {
            [fieldName] = new[] { message },
        };
    }

    public ValidationException(IDictionary<string, string[]> errors)
        : base("One or more validation errors occurred.")
    {
        Errors = errors;
    }
}
