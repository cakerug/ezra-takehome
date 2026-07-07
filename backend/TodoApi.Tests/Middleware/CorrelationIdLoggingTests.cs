using System.Collections.Concurrent;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging;
using TodoApi.Middleware;

namespace TodoApi.Tests.Middleware;

/// <summary>
/// Verifies the substance of R14: the correlation ID established by
/// <see cref="CorrelationIdMiddleware"/> is present in the active logging scope at the moment
/// downstream code writes a log entry. That is exactly what a scope-aware console formatter
/// (IncludeScopes=true, configured in appsettings.json) reads out onto each log line — so this
/// captures scopes through the same framework-native <see cref="IExternalScopeProvider"/> seam a
/// formatter uses. Header echo is covered separately in <see cref="CorrelationIdMiddlewareTests"/>;
/// this closes the gap where the ID was attached to a scope that nothing observed.
/// </summary>
public class CorrelationIdLoggingTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly ScopeCapturingLoggerProvider _capturedLogs = new();
    private readonly WebApplicationFactory<Program> _factory;

    public CorrelationIdLoggingTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureLogging(logging => logging.AddProvider(_capturedLogs));

            builder.Configure(app =>
            {
                app.UseMiddleware<CorrelationIdMiddleware>();

                app.UseRouting();
                app.UseEndpoints(endpoints =>
                {
                    endpoints.MapGet("/test/log", (ILoggerFactory loggerFactory) =>
                    {
                        loggerFactory.CreateLogger("Test").LogInformation("handling request");
                        return Results.Ok("ok");
                    });
                });
            });
        });
    }

    [Fact]
    public async Task CorrelationId_IsPresentInTheLoggingScope_WhenDownstreamCodeLogs()
    {
        var client = _factory.CreateClient();
        const string suppliedId = "trace-me-abc-123";
        var request = new HttpRequestMessage(HttpMethod.Get, "/test/log");
        request.Headers.TryAddWithoutValidation(CorrelationIdMiddleware.HeaderName, suppliedId);

        await client.SendAsync(request);

        Assert.Contains(_capturedLogs.CapturedScopes, scope =>
            scope is IEnumerable<KeyValuePair<string, object>> pairs &&
            pairs.Any(pair =>
                pair.Key == "CorrelationId" &&
                string.Equals(pair.Value?.ToString(), suppliedId, StringComparison.Ordinal)));
    }

    /// <summary>
    /// Minimal logger provider that records the active scope chain every time anything is logged,
    /// by reading the shared external scope provider the logging factory hands it — the same way
    /// the real console formatter consumes scopes.
    /// </summary>
    private sealed class ScopeCapturingLoggerProvider : ILoggerProvider, ISupportExternalScope
    {
        private IExternalScopeProvider? _scopeProvider;

        public ConcurrentBag<object?> CapturedScopes { get; } = new();

        public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopeProvider = scopeProvider;

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(this);

        public void Dispose()
        {
        }

        private void CaptureScopes() =>
            _scopeProvider?.ForEachScope((scope, bag) => bag.Add(scope), CapturedScopes);

        private sealed class CapturingLogger : ILogger
        {
            private readonly ScopeCapturingLoggerProvider _owner;

            public CapturingLogger(ScopeCapturingLoggerProvider owner) => _owner = owner;

            public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter) => _owner.CaptureScopes();
        }

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();

            public void Dispose()
            {
            }
        }
    }
}
