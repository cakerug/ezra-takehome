using TodoApi.Exceptions;

namespace TodoApi.Validation;

/// <summary>
/// Static guard-clause helpers for validating text fields on incoming requests. These throw
/// <see cref="ValidationException"/> on failure, which the global exception-handling middleware
/// maps to a 400 ProblemDetails response naming the offending field. Intended to be called by
/// later units' operation functions (e.g. U3's ProjectOperations, U4's TaskOperations) — there
/// is no caller for these yet within this unit.
/// </summary>
public static class FieldValidation
{
    /// <summary>
    /// Ensures a required text field is present (non-null, non-empty, non-whitespace-only).
    /// </summary>
    public static void EnsureRequired(string? value, string fieldName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ValidationException(fieldName, $"{fieldName} is required.");
        }
    }

    /// <summary>
    /// Ensures a text field does not exceed the given max length. Null/empty values are
    /// considered valid here — pair with <see cref="EnsureRequired"/> to also enforce presence.
    /// </summary>
    public static void EnsureMaxLength(string? value, int maxLength, string fieldName)
    {
        if (value is not null && value.Length > maxLength)
        {
            throw new ValidationException(
                fieldName,
                $"{fieldName} must not exceed {maxLength} characters.");
        }
    }

    /// <summary>
    /// Convenience combinator for a required field that also has a max length (e.g. Task title,
    /// Project name).
    /// </summary>
    public static void EnsureRequiredWithMaxLength(string? value, int maxLength, string fieldName)
    {
        EnsureRequired(value, fieldName);
        EnsureMaxLength(value, maxLength, fieldName);
    }
}
