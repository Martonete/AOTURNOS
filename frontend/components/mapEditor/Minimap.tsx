"use client";

import { useEffect, useRef } from "react";
import type { GraphicsDB } from "../../types/game";
import type { EditorScene } from "./EditorScene";
import { editor, useEditor } from "./editorStore";
import { staticFrame, useGraphicsDB } from "./GraphicThumb";

const SIZE = 200;

/** Color promedio de cada gráfico, calculado una vez dibujándolo en un canvas de 1×1. */
const colorCache = new Map<number, string>();
const sheetCache = new Map<string, Promise<HTMLImageElement | null>>();

function sheet(file: string): Promise<HTMLImageElement | null> {
    let promise = sheetCache.get(file);
    if (!promise) {
        promise = new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = `/graphics/${file}.png`;
        });
        sheetCache.set(file, promise);
    }
    return promise;
}

async function colorsFor(db: GraphicsDB, grhs: Iterable<number>): Promise<void> {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    await Promise.all(
        [...new Set(grhs)]
            .filter((g) => g && !colorCache.has(g))
            .map(async (g) => {
                const frame = staticFrame(db, g);
                const img = frame ? await sheet(frame.numFile) : null;
                if (!frame || !img) return colorCache.set(g, "transparent");
                ctx.clearRect(0, 0, 1, 1);
                ctx.drawImage(img, frame.sX, frame.sY, frame.width, frame.height, 0, 0, 1, 1);
                const [r, gg, b, a] = ctx.getImageData(0, 0, 1, 1).data;
                colorCache.set(g, a < 40 ? "transparent" : `rgb(${r},${gg},${b})`);
            }),
    );
}

/**
 * Minimapa: un píxel por casilla con el color promedio de su gráfico más alto. Clic o arrastre
 * para mover la cámara; el recuadro dorado es lo que se ve en el lienzo.
 */
export function Minimap({ scene }: { scene: EditorScene | null }) {
    const base = useRef<HTMLCanvasElement>(null);
    const frame = useRef<HTMLCanvasElement>(null);
    const db = useGraphicsDB();
    const revision = useEditor((s) => s.revision);
    const mapId = useEditor((s) => s.mapId);

    // Redibuja el mapa un rato después del último cambio, para no frenar el pincel.
    useEffect(() => {
        const doc = editor.doc;
        const canvas = base.current;
        if (!db || !doc || !canvas) return;
        const id = setTimeout(async () => {
            const grhs: number[] = [];
            for (const layer of doc.layers.slice(0, 3)) for (const g of layer) if (g) grhs.push(g);
            await colorsFor(db, grhs);
            canvas.width = doc.width;
            canvas.height = doc.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.fillStyle = "#0b0d12";
            ctx.fillRect(0, 0, doc.width, doc.height);
            for (let i = 0; i < doc.size; i++) {
                const x = i % doc.width;
                const y = Math.floor(i / doc.width);
                for (const l of [0, 1, 2]) {
                    const color = colorCache.get(doc.layers[l][i]);
                    if (color && color !== "transparent") {
                        ctx.fillStyle = color;
                        ctx.fillRect(x, y, 1, 1);
                    }
                }
                if (doc.exits.has(i)) {
                    ctx.fillStyle = "#29d3ff";
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }, 350);
        return () => clearTimeout(id);
    }, [db, revision, mapId]);

    // El recuadro de la cámara se redibuja cada vez que se mueve.
    useEffect(() => {
        if (!scene) return;
        const draw = () => {
            const doc = editor.doc;
            const canvas = frame.current;
            const ctx = canvas?.getContext("2d");
            if (!doc || !canvas || !ctx) return;
            const k = SIZE / Math.max(doc.width, doc.height);
            const view = scene.viewRect();
            ctx.clearRect(0, 0, SIZE, SIZE);
            ctx.strokeStyle = "#f5c56a";
            ctx.lineWidth = 1.5;
            ctx.strokeRect((view.x - 1) * k, (view.y - 1) * k, view.width * k, view.height * k);
        };
        draw();
        return scene.onCamera(draw);
    }, [scene, mapId]);

    const jump = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const doc = editor.doc;
        if (!doc || !scene || (e.type === "pointermove" && e.buttons !== 1)) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const k = SIZE / Math.max(doc.width, doc.height);
        scene.centerOn((e.clientX - rect.left) / k + 1, (e.clientY - rect.top) / k + 1);
    };

    return (
        <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
            <canvas ref={base} className="absolute inset-0 h-full w-full rounded-md border border-white/10" style={{ imageRendering: "pixelated" }} />
            <canvas
                ref={frame}
                width={SIZE}
                height={SIZE}
                onPointerDown={jump}
                onPointerMove={jump}
                className="absolute inset-0 cursor-pointer"
                title="Clic o arrastre para moverte por el mapa"
            />
        </div>
    );
}
