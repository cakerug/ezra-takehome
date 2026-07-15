using System.Text;
using System.Text.Json.Nodes;

namespace TodoApi.Middleware;

/// <summary>
/// Patches the native Minimal API DataAnnotations validation filter's response (enabled via
/// AddValidation() in Program.cs) to match ExceptionHandlingMiddleware's ProblemDetails shape.
/// That filter short-circuits with its own 400 before ExceptionHandlingMiddleware's try/catch
/// ever runs, and does not route through IProblemDetailsService on the installed SDK -- confirmed
/// by testing a CustomizeProblemDetails callback directly, which never fired for it -- so there is
/// no supported hook to reshape it upstream. This buffers the response body instead and rewrites
/// it after the fact, identifying the native filter's output by its distinguishing
/// "application/json" (rather than "application/problem+json") content type on a 400.
/// </summary>
public class ValidationProblemNormalizationMiddleware
{
    private readonly RequestDelegate _next;

    public ValidationProblemNormalizationMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;

        try
        {
            await _next(context);
        }
        finally
        {
            context.Response.Body = originalBody;
        }

        var isNakedValidationResponse =
            context.Response.StatusCode == StatusCodes.Status400BadRequest &&
            context.Response.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true;

        buffer.Seek(0, SeekOrigin.Begin);

        if (!isNakedValidationResponse)
        {
            await buffer.CopyToAsync(originalBody);
            return;
        }

        var problem = await JsonNode.ParseAsync(buffer);
        problem!["status"] = StatusCodes.Status400BadRequest;
        problem["instance"] = context.Request.Path.Value;

        var patched = Encoding.UTF8.GetBytes(problem.ToJsonString());

        context.Response.ContentType = "application/problem+json";
        context.Response.ContentLength = patched.Length;
        await originalBody.WriteAsync(patched);
    }
}
