using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TodoApi.Exceptions;
using ValidationException = TodoApi.Exceptions.ValidationException;

namespace TodoApi.Middleware;

/// <summary>
/// Global exception-handling middleware. Catches application-defined exceptions and any other
/// unhandled exception, mapping each to a <see cref="ProblemDetails"/> (or
/// <see cref="ValidationProblemDetails"/>) response:
///   - <see cref="NotFoundException"/> -> 404
///   - <see cref="ValidationException"/> -> 400, with per-field errors
///   - <see cref="ForbiddenOperationException"/> -> 403
///   - <see cref="DbUpdateException"/> -> 409; a concurrent request changed or removed a row this
///     request depended on (e.g. a task's target project was deleted mid-move). Covers the move,
///     reorder, and delete races in one place so the operations don't each need a re-check.
///   - anything else -> 500, generic body only; the real exception is logged server-side and
///     never leaked (no stack trace, no exception message) to the client.
///
/// Placed after <see cref="CorrelationIdMiddleware"/> in the pipeline so that any exception
/// logged here already has the correlation ID attached to the logging scope.
/// </summary>
public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (NotFoundException ex)
        {
            // Expected control flow, not a fault: log the message only, no stack trace.
            _logger.LogWarning("Resource not found: {Message}", ex.Message);
            await WriteProblemDetailsAsync(
                context,
                StatusCodes.Status404NotFound,
                "Not Found",
                ex.Message);
        }
        catch (ValidationException ex)
        {
            _logger.LogWarning("Validation failed: {Message}", ex.Message);
            await WriteValidationProblemDetailsAsync(context, ex);
        }
        catch (ForbiddenOperationException ex)
        {
            _logger.LogWarning("Forbidden operation: {Message}", ex.Message);
            await WriteProblemDetailsAsync(
                context,
                StatusCodes.Status403Forbidden,
                "Forbidden",
                ex.Message);
        }
        catch (DbUpdateException ex)
        {
            // A concurrent request changed or removed a row this one depended on (e.g. the target
            // project was deleted between validation and save). Keep full detail server-side for
            // diagnosis, but return a clean 409 rather than an opaque 500.
            _logger.LogWarning(ex, "Concurrent update conflict while processing request {Path}", context.Request.Path);
            await WriteProblemDetailsAsync(
                context,
                StatusCodes.Status409Conflict,
                "Conflict",
                "The resource was modified or removed by another request. Please retry.");
        }
        catch (Exception ex)
        {
            // Unhandled exception: log full details server-side, but return a generic body so
            // no stack trace or internal exception message reaches the client.
            _logger.LogError(ex, "Unhandled exception while processing request {Path}", context.Request.Path);
            await WriteProblemDetailsAsync(
                context,
                StatusCodes.Status500InternalServerError,
                "Internal Server Error",
                "An unexpected error occurred. Please try again later.");
        }
    }

    private static Task WriteProblemDetailsAsync(
        HttpContext context,
        int statusCode,
        string title,
        string detail)
    {
        var problemDetails = new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Detail = detail,
            Instance = context.Request.Path,
        };

        return WriteResponseAsync(context, statusCode, problemDetails);
    }

    private static Task WriteValidationProblemDetailsAsync(HttpContext context, ValidationException ex)
    {
        var problemDetails = new ValidationProblemDetails(ex.Errors)
        {
            Status = StatusCodes.Status400BadRequest,
            Title = "One or more validation errors occurred.",
            Detail = ex.Message,
            Instance = context.Request.Path,
        };

        return WriteResponseAsync(context, StatusCodes.Status400BadRequest, problemDetails);
    }

    private static async Task WriteResponseAsync(HttpContext context, int statusCode, object problemDetails)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        await context.Response.WriteAsJsonAsync(
            problemDetails,
            options: null,
            contentType: "application/problem+json");
    }
}
