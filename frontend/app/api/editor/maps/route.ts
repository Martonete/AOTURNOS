import { NextResponse } from "next/server";
import { clientOnlyMapIds, listMaps, mapEditorEnabled, MAX_EDITABLE_MAP_ID } from "../../../../lib/mapEditorStorage";

/**
 * Lista de mapas para el selector del editor. El número sugerido para un mapa nuevo va después del
 * más alto: los huecos (como el 110, que solo existe en el navegador) pueden estar en uso.
 */
export async function GET(): Promise<NextResponse> {
    if (!mapEditorEnabled()) return NextResponse.json({ error: "El editor de mapas está apagado." }, { status: 404 });
    const maps = await listMaps();
    const reserved = await clientOnlyMapIds(new Set(maps.map((m) => m.id)));
    const highest = Math.max(0, ...[...maps.map((m) => m.id), ...reserved].filter((id) => id <= MAX_EDITABLE_MAP_ID));
    const nextFreeId = highest < MAX_EDITABLE_MAP_ID ? highest + 1 : null;
    return NextResponse.json({ maps, reserved, nextFreeId, maxId: MAX_EDITABLE_MAP_ID });
}
