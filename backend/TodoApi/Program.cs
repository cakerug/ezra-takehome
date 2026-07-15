using Microsoft.EntityFrameworkCore;
using NetEscapades.AspNetCore.SecurityHeaders;
using TodoApi.Data;
using TodoApi.Endpoints;
using TodoApi.Middleware;

var builder = WebApplication.CreateBuilder(args);

const string FrontendCorsPolicy = "FrontendCorsPolicy";

// Render scopes on each console log line so the correlation ID established by
// CorrelationIdMiddleware is visible in the logs (satisfies R14's "trace a request" end-to-end,
// not just as an echoed response header). AddSimpleConsole reconfigures the console provider the
// host already registered rather than adding a second one.
builder.Logging.AddSimpleConsole(options => options.IncludeScopes = true);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? "Data Source=todo.db;Foreign Keys=True";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(connectionString));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c => c.SupportNonNullableReferenceTypes());
builder.Services.AddHealthChecks();

var securityHeadersPolicies = new HeaderPolicyCollection()
    .AddDefaultSecurityHeaders()
    .AddContentSecurityPolicy(csp => csp.AddDefaultSrc().Self());

// Origin(s) the SPA is served from, for CORS. Read from configuration (env var `FrontendOrigins`,
// comma-separated for multiple) so the dev port isn't baked in and can be overridden per run;
// defaults to Vite's default dev port. No credentials/cookies are involved (no auth yet), so a
// simple allow-list plus the methods/headers the API actually uses is enough — no AllowCredentials
// or wildcard origin needed.
var frontendOrigins = (builder.Configuration["FrontendOrigins"] ?? "http://localhost:5173")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
    {
        policy.WithMethods("GET", "POST", "PUT", "DELETE")
            .WithHeaders("Content-Type", CorrelationIdMiddleware.HeaderName);

        // In development the SPA's port is not fixed — dev tooling may assign a free
        // port (e.g. Vite's autoPort) that differs per run — so allow any loopback
        // origin instead of a baked-in list. No credentials/cookies are involved, so
        // this is safe. Production stays locked to the configured allow-list.
        if (builder.Environment.IsDevelopment())
        {
            policy.SetIsOriginAllowed(origin =>
                Uri.TryCreate(origin, UriKind.Absolute, out var uri)
                && (uri.Host == "localhost" || uri.Host == "127.0.0.1"));
        }
        else
        {
            policy.WithOrigins(frontendOrigins);
        }
    });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
    await DbSeeder.SeedAsync(db);
}

// CORS must run early in the pipeline — before the correlation-ID/exception-handling middleware
// and endpoint routing — so that preflight OPTIONS requests are answered directly instead of
// falling through to routes that don't handle OPTIONS and would otherwise 404.
app.UseSecurityHeaders(securityHeadersPolicies);

app.UseCors(FrontendCorsPolicy);

// Enabled unconditionally (not gated behind IsDevelopment()): for this small MVP, Swagger being
// reachable is itself a requirement (R12), not just a dev convenience.
app.UseSwagger();
app.UseSwaggerUI();

// Correlation-ID middleware runs first so the correlation ID is established (and attached to
// the logging scope) before anything else in the pipeline — including the exception handler —
// has a chance to log. Exception handling wraps everything after it, so any exception thrown by
// later middleware or endpoints is still caught and logged with that same correlation ID.
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<ExceptionHandlingMiddleware>();

// Liveness probe for uptime checks / container orchestrators. Cheap production-readiness signal;
// returns 200 "Healthy" without touching the database.
app.MapHealthChecks("/health");

app.MapProjectEndpoints();
app.MapTaskEndpoints();

app.Run();

public partial class Program
{
}
