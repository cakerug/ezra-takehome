using System.Net;
using System.Net.Http;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TodoApi.Data;
using TodoApi.Middleware;

namespace TodoApi.Tests;

/// <summary>
/// Verifies the two cross-cutting U5 concerns that aren't tied to a specific resource:
/// - R12: Swagger/OpenAPI documentation is reachable.
/// - CORS: the frontend's dev origin can call the API, including preflight OPTIONS requests.
///
/// Uses the same WebApplicationFactory + temp-file SQLite pattern as ProjectEndpointsTests.
/// </summary>
public class ApiDocumentationAndCorsTests : IDisposable
{
    private readonly string _dbPath;
    private readonly string _connectionString;
    private readonly WebApplicationFactory<Program> _factory;

    public ApiDocumentationAndCorsTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"todoapi-docs-cors-test-{Guid.NewGuid()}.db");
        _connectionString = $"Data Source={_dbPath};Foreign Keys=True";

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.AddDbContext<AppDbContext>(options =>
                    options.UseSqlite(_connectionString));
            });
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Database.Migrate();
    }

    public void Dispose()
    {
        _factory.Dispose();
        SqliteConnection.ClearAllPools();
        if (File.Exists(_dbPath))
        {
            File.Delete(_dbPath);
        }
    }

    [Fact]
    public async Task SwaggerJson_Returns200AndValidOpenApiDocumentListingProjectAndTaskEndpoints()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/swagger/v1/swagger.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body); // Throws if not valid JSON.

        var paths = document.RootElement.GetProperty("paths");
        Assert.True(paths.TryGetProperty("/api/projects", out _));
        Assert.True(paths.TryGetProperty("/api/projects/{projectId}/tasks", out _));
    }

    [Fact]
    public async Task SwaggerUiPage_Returns200()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/swagger");

        // The default Swagger UI middleware redirects "/swagger" to "/swagger/index.html";
        // HttpClient follows redirects by default, so we should land on a 200 HTML page.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("swagger", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PreflightOptionsRequestFromFrontendOrigin_IsAllowedByCors()
    {
        var client = _factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Options, "/api/projects");
        request.Headers.Add("Origin", "http://localhost:5173");
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", CorrelationIdMiddleware.HeaderName);

        var response = await client.SendAsync(request);

        Assert.True(response.IsSuccessStatusCode, $"Expected a successful preflight response, got {(int)response.StatusCode}.");
        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Contains("http://localhost:5173", response.Headers.GetValues("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task RequestFromDisallowedOrigin_DoesNotReceiveCorsAllowHeader()
    {
        var client = _factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/api/projects");
        request.Headers.Add("Origin", "http://evil.example.com");

        var response = await client.SendAsync(request);

        // The request itself still succeeds (CORS is enforced by the browser, not the server),
        // but the server must not echo back an Allow-Origin header for a non-allow-listed origin.
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }
}
