using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using NetEscapades.AspNetCore.SecurityHeaders;
using TodoApi.Data;
using TodoApi.Endpoints;
using TodoApi.Middleware;

var builder = WebApplication.CreateBuilder(args);

const string FrontendCorsPolicy = "FrontendCorsPolicy";

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? "Data Source=todo.db;Foreign Keys=True";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(connectionString));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c => c.SupportNonNullableReferenceTypes());
builder.Services.AddHealthChecks();

// Native Minimal API DataAnnotations validation (new in .NET 10). Runs as an endpoint filter
// before the handler executes, short-circuiting with its own 400 response — it does NOT throw,
// so ExceptionHandlingMiddleware never sees these failures. AddProblemDetails routes that
// response through IProblemDetailsService instead, aligning its Content-Type/status with
// ExceptionHandlingMiddleware's hand-thrown ValidationException path; CustomizeProblemDetails
// adds the one field (Instance) that service doesn't set by default.
builder.Services.AddValidation();
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = ctx =>
    {
        ctx.ProblemDetails.Instance = ctx.HttpContext.Request.Path;
    };
});

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

// Fixed-window: simplest and cheapest of the built-in algorithms (fixed window, sliding window,
// token bucket, concurrency). Sliding window would smooth out the boundary-burst behavior fixed
// window has, but that smoothing is overkill for this app's traffic pattern (a handful of CRUD
// endpoints, no public/adversarial traffic). Token bucket — which allows bursts up to a capacity
// while enforcing a long-run average — could make sense for a bulk-import-style endpoint, but
// that's a different endpoint shape than what exists here.
//
// This limiter is in-memory and per-process. In a horizontally-scaled deployment (multiple
// backend instances behind a load balancer), each instance would enforce its own limit
// independently, so the effective limit multiplies with instance count. A production system at
// that scale would centralize counters in a shared store (e.g. Redis) or enforce the limit at
// the load balancer / API gateway instead of in-process.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 100,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
    {
        policy.WithMethods("GET", "POST", "PUT", "DELETE")
            .WithHeaders("Content-Type");

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

// CORS must run early in the pipeline — before the exception-handling middleware and endpoint
// routing — so that preflight OPTIONS requests are answered directly instead of falling through
// to routes that don't handle OPTIONS and would otherwise 404.
app.UseSecurityHeaders(securityHeadersPolicies);

app.UseCors(FrontendCorsPolicy);

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseRateLimiter();

// Liveness probe for uptime checks / container orchestrators. Cheap production-readiness signal;
// returns 200 "Healthy" without touching the database.
app.MapHealthChecks("/health");

app.MapProjectEndpoints();
app.MapTaskEndpoints();

app.Run();

public partial class Program
{
}
