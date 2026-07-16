using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TodoApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddProjectCreatedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Projects that predate this column have no recorded creation time, so they are
            // backfilled with this migration's authoring time: not their true creation time, but a
            // plausible upper bound that sorts sensibly. The scaffolded default (DateTime.MinValue)
            // would instead surface as a year-0001 date indistinguishable from a bug. The value is
            // a literal rather than CURRENT_TIMESTAMP because SQLite rejects non-constant defaults
            // in ALTER TABLE ADD COLUMN.
            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "Projects",
                type: "TEXT",
                nullable: false,
                defaultValue: new DateTime(2026, 7, 16, 15, 53, 31, DateTimeKind.Utc));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "Projects");
        }
    }
}
