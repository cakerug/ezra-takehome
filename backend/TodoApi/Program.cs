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

// Native "Minimal API" DataAnnotations validation (new in .NET 10). Runs as an endpoint filter
// before the handler executes, short-circuiting with its own 400 response — it does NOT throw,
// so ExceptionHandlingMiddleware never sees these failures. AddProblemDetails routes that
// response through IProblemDetailsService instead, aligning its Content-Type/status with
// ExceptionHandlingMiddleware's hand-thrown ValidationException path; CustomizeProblemDetails
// adds the one field (Instance) that service doesn't set by default.
// That way, error-handling on the frontend can be the same
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

// It's always a bit safer to have a rate limiter even though I don't anticipate anything to happen!
// This was quick and easy to add in dotnet.
// Use a fixed-window b/c it's simplest. Could change it to sliding window if needed.
// If we ended up scaling this, you would use a different service so that it gets an idea of global traffic instead of
// per-server. 
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

// Origin(s) the SPA is served from, for CORS. Read from configuration (env var `FrontendOrigins`,
// comma-separated for multiple) so the dev port isn't baked in and can be overridden per run;
// defaults to Vite's default dev port.
var frontendOrigins = (builder.Configuration["FrontendOrigins"] ?? "http://localhost:5173")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
    {
        policy.WithMethods("GET", "POST", "PATCH", "PUT", "DELETE")
            .WithHeaders("Content-Type");

        // In development the SPA's port is not fixed — dev tooling assigns a free
        // port (e.g. Vite's autoPort) that differs per run. I did this because I had
        // multiple agents changing the frontend at the same time and testing the changes.
        // So this allows any localhost origin instead of a baked-in list.
        // The only risk is another localhost. But fine for this app.
        // No credentials/cookies are involved.
        // Production stays locked to the configured allow-list.
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

// Security headers should be applied first so that they protect all responses,
// including errors and rate-limiting responses.
app.UseSecurityHeaders(securityHeadersPolicies);

// CORS must run early in the pipeline — before the exception-handling middleware and endpoint
// routing — so that preflight OPTIONS requests are answered directly instead of falling through
// to routes that don't handle OPTIONS and would otherwise 404.
app.UseCors(FrontendCorsPolicy);

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseRateLimiter();

// Liveness probe for uptime checks / container orchestrators.
app.MapHealthChecks("/health");

app.MapProjectEndpoints();
app.MapTaskEndpoints();

app.Run();

// For testing
public partial class Program
{
}
