import { NextResponse } from "next/server";
import type { MapSource } from "@aoturnos/game-core";
import { mapEditorEnabled, readMap, validateMap, writeMap } from "../../../../../lib/mapEditorStorage";

type Params = { params: Promise<{ id: string }> };

const disabled = () => NextResponse.json({ error: "El editor de mapas está apagado." }, { status: 404 });

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
    if (!mapEditorEnabled()) return disabled();
    const id = Number((await params).id);
    const source = Number.isInteger(id) ? await readMap(id) : null;
    if (!source) return NextResponse.json({ error: `No existe el mapa ${id}.` }, { status: 404 });
    return NextResponse.json(source);
}

/** Guarda el mapa entero. El editor manda siempre los cuatro archivos ya armados por MapDocument.toSource. */
export async function PUT(request: Request, { params }: Params): Promise<NextResponse> {
    if (!mapEditorEnabled()) return disabled();
    const id = Number((await params).id);
    let source: MapSource;
    try {
        source = (await request.json()) as MapSource;
    } catch {
        return NextResponse.json({ error: "El cuerpo no es JSON válido." }, { status: 400 });
    }
    const problem = validateMap(id, source);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    await writeMap(id, source);
    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
}
