using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TodoApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class ReplaceIsDefaultWithProjectOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Drop IsDefault outright rather than renaming it to Order: its 0/1 values carry no
            // meaningful sort order, so a rename would seed nonsensical Order values. New rows
            // default to Order 0.
            migrationBuilder.DropColumn(
                name: "IsDefault",
                table: "Projects");

            migrationBuilder.AddColumn<int>(
                name: "Order",
                table: "Projects",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Order",
                table: "Projects");

            migrationBuilder.AddColumn<bool>(
                name: "IsDefault",
                table: "Projects",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }
    }
}
