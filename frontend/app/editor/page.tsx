import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapEditor } from "../../components/mapEditor/MapEditor";
import { mapEditorEnabled } from "../../lib/mapEditorStorage";

// Se decide al pedir la página, no al compilar: MAP_EDITOR se lee en el servidor.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Editor de mapas", robots: { index: false } };

/** Editor de mapas del mundo. Solo existe en desarrollo o con MAP_EDITOR=1 (ver lib/mapEditorStorage). */
export default function EditorPage() {
    if (!mapEditorEnabled()) notFound();
    return <MapEditor />;
}
