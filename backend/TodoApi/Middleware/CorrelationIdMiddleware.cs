namespace TodoApi.Middleware;

/// <summary>
/// Reads the "X-Correlation-Id" request header if present, or generates a new GUID if absent.
/// Attaches the value to the logging scope for the duration of the request (so every log line
/// written while handling it includes the correlation ID) and echoes it back in the
/// "X-Correlation-Id" response header.
///
/// This middleware is placed first in the pipeline, ahead of exception handling, so that the
/// correlation ID is established before any downstream component (including the exception
/// handler itself) logs anything for this request.
/// </summary>
public class CorrelationIdMiddleware
{
    public const string HeaderName = "X-Correlation-Id";

    private readonly RequestDelegate _next;
    private readonly ILogger<CorrelationIdMiddleware> _logger;

    public CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = ResolveCorrelationId(context);

        // Echo back immediately (before the response starts) so it is present on every
        // response, including ones short-circuited by later middleware.
        context.Response.OnStarting(() =>
        {
            context.Response.Headers[HeaderName] = correlationId;
            return Task.CompletedTask;
        });

        using (_logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
        {
            await _next(context);
        }
    }

    private static string ResolveCorrelationId(HttpContext context)
    {
        if (context.Request.Headers.TryGetValue(HeaderName, out var existing) &&
            !string.IsNullOrWhiteSpace(existing))
        {
            return existing.ToString();
        }

        return Guid.NewGuid().ToString();
    }
}
