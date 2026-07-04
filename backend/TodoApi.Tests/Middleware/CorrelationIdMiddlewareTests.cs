using System.Net.Http.Headers;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using TodoApi.Middleware;

namespace TodoApi.Tests.Middleware;

/// <summary>
/// Integration tests for <see cref="CorrelationIdMiddleware"/>, using a minimal test-only
/// pipeline (correlation-id + exception-handling middleware, plus a trivial echo endpoint) so
/// this can be verified end-to-end without depending on any real U3/U4 endpoints.
/// </summary>
public class CorrelationIdMiddlewareTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public CorrelationIdMiddlewareTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.Configure(app =>
            {
                app.UseMiddleware<CorrelationIdMiddleware>();
                app.UseMiddleware<ExceptionHandlingMiddleware>();

                app.UseRouting();

                app.UseEndpoints(endpoints =>
                {
                    endpoints.MapGet("/test/echo", () => Results.Ok("ok"));
                });
            });
        });
    }

    [Fact]
    public async Task RequestWithoutCorrelationIdHeader_GetsOneGeneratedAndEchoedBack()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/test/echo");

        response.EnsureSuccessStatusCode();
        Assert.True(response.Headers.TryGetValues(CorrelationIdMiddleware.HeaderName, out var values));
        var correlationId = Assert.Single(values!);

        Assert.False(string.IsNullOrWhiteSpace(correlationId));
        Assert.True(Guid.TryParse(correlationId, out _));
    }

    [Fact]
    public async Task RequestWithCorrelationIdHeader_GetsTheExactSameValueEchoedBack()
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/test/echo");
        var suppliedCorrelationId = "my-custom-correlation-id-12345";
        request.Headers.TryAddWithoutValidation(CorrelationIdMiddleware.HeaderName, suppliedCorrelationId);

        var response = await client.SendAsync(request);

        response.EnsureSuccessStatusCode();
        Assert.True(response.Headers.TryGetValues(CorrelationIdMiddleware.HeaderName, out var values));
        var echoedCorrelationId = Assert.Single(values!);

        Assert.Equal(suppliedCorrelationId, echoedCorrelationId);
    }
}
