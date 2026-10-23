import { NextResponse } from "next/server";
import { mapEditorEnabled, worldUsage } from "../../../../lib/mapEditorStorage";

/** Gráficos usados en todo el mundo, por capa y del más usado al menos usado: [grh, baldosas][]. */
export async function GET(): Promise<NextResponse> {
    if (!mapEditorEnabled()) return NextResponse.json({ error: "El editor de mapas está apagado." }, { status: 404 });
    return NextResponse.json({ layers: await worldUsage() });
}
