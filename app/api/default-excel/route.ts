import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "database.xlsx");
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "File database.xlsx tidak ditemukan di root folder project." },
        { status: 404 }
      );
    }

    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="database.xlsx"',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal membaca database.xlsx",
      },
      { status: 500 }
    );
  }
}
