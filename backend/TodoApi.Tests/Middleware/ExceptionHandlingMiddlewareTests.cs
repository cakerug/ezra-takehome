using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TodoApi.Exceptions;
using ValidationException = TodoApi.Exceptions.ValidationException;

namespace TodoApi.Tests.Middleware;

/// <summary>
/// Integration tests for the global exception-handling middleware pipeline wired up in
/// Program.cs. Rather than driving the real endpoints (which would couple these tests to the
/// business rules that happen to throw each exception type today), this factory maps a handful of
/// throwaway test-only endpoints that each throw a specific exception type, purely to exercise
/// the middleware end-to-end. These routes are never added to the real Program.cs — they are
/// mapped here, scoped entirely to the test project, via ConfigureWebHost.
/// </summary>
public class ExceptionHandlingMiddlewareTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public ExceptionHandlingMiddlewareTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.Configure(app =>
            {
                app.UseMiddleware<TodoApi.Middleware.ExceptionHandlingMiddleware>();

                app.UseRouting();

                app.UseEndpoints(endpoints =>
                {
                    endpoints.MapGet("/test/echo", () => Results.Ok("ok"));

                    endpoints.MapGet("/test/not-found", TestEndpoints.NotFound);
                    endpoints.MapGet("/test/invalid", TestEndpoints.Invalid);
                    endpoints.MapGet("/test/forbidden", TestEndpoints.Forbidden);
                    endpoints.MapGet("/test/conflict", TestEndpoints.Conflict);
                    endpoints.MapGet("/test/boom", TestEndpoints.Boom);
                });
            });
        });
    }

    [Fact]
    public async Task NotFoundException_Yields404WithProblemDetailsShape()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/test/not-found");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;

        Assert.Equal(404, root.GetProperty("status").GetInt32());
        Assert.Contains("not found", root.GetProperty("detail").GetString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UnhandledException_Yields500WithGenericBodyAndNoLeakedDetails()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/test/boom");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();

        // The real exception type/message/stack trace must never appear in the response body.
        Assert.DoesNotContain("super secret internal detail", body);
        Assert.DoesNotContain("InvalidOperationException", body);
        Assert.DoesNotContain("StackTrace", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(" at ", body);

        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;
        Assert.Equal(500, root.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task ValidationException_Yields400WithProblemDetailsNamingTheField()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/test/invalid");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;

        Assert.Equal(400, root.GetProperty("status").GetInt32());

        var errors = root.GetProperty("errors");
        Assert.True(errors.TryGetProperty("Title", out var titleErrors));
        Assert.Contains("required", titleErrors[0].GetString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DbUpdateException_Yields409WithoutLeakingInternalDetails()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/test/conflict");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();

        // The underlying EF/database detail must not reach the client; only a generic retry hint.
        Assert.DoesNotContain("simulated concurrent update", body);

        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;

        Assert.Equal(409, root.GetProperty("status").GetInt32());
        Assert.Contains("retry", root.GetProperty("detail").GetString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ForbiddenOperationException_Yields403WithProblemDetailsShape()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/test/forbidden");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;

        Assert.Equal(403, root.GetProperty("status").GetInt32());
    }

    private static class TestEndpoints
    {
        public static IResult NotFound()
        {
            throw new NotFoundException("Task with id 999 was not found.");
        }

        public static IResult Invalid()
        {
            throw new ValidationException("Title", "Title is required.");
        }

        public static IResult Forbidden()
        {
            throw new ForbiddenOperationException("This operation is not allowed.");
        }

        public static IResult Conflict()
        {
            throw new DbUpdateException("simulated concurrent update conflict");
        }

        public static IResult Boom()
        {
            throw new InvalidOperationException("super secret internal detail that must never leak");
        }
    }
}
