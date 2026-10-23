"use client";

import { useEffect, useState } from "react";
import type { GraphicData, GraphicsDB } from "../../types/game";
import { loadGraphicsDB } from "../../utils/gameLoader";

let graphicsPromise: Promise<GraphicsDB> | null = null;

/** La base de gráficos (graficos_optimized.json), cargada una sola vez para todas las miniaturas. */
export function useGraphicsDB(): GraphicsDB | null {
    const [db, setDb] = useState<GraphicsDB | null>(null);
    useEffect(() => {
        let alive = true;
        graphicsPromise ??= loadGraphicsDB();
        void graphicsPromise.then((value) => alive && setDb(value));
        return () => {
            alive = false;
        };
    }, []);
    return db;
}

/** Primer cuadro de un gráfico: los animados guardan sus cuadros como otros ids. */
export function staticFrame(db: GraphicsDB, grh: number): GraphicData | null {
    const data = db[String(grh)];
    if (!data) return null;
    if (data.numFrames > 1 && data.frames) {
        const first = db[String(data.frames["1"] ?? Object.values(data.frames)[0])];
        return first ?? null;
    }
    return data;
}

/**
 * Miniatura de un gráfico recortada directo de su hoja con CSS: no hace falta Pixi ni canvas,
 * y el navegador carga cada hoja una sola vez.
 */
export function GraphicThumb({ db, grh, size = 44 }: { db: GraphicsDB; grh: number; size?: number }) {
    const frame = staticFrame(db, grh);
    if (!frame) return <span className="text-[10px] text-white/30">?</span>;
    const scale = Math.min(1, size / Math.max(frame.width, frame.height));
    return (
        <span className="relative block overflow-hidden" style={{ width: size, height: size }}>
            <span
                className="absolute left-1/2 top-1/2 block"
                style={{
                    width: frame.width,
                    height: frame.height,
                    backgroundImage: `url(/graphics/${frame.numFile}.png)`,
                    backgroundPosition: `-${frame.sX}px -${frame.sY}px`,
                    imageRendering: "pixelated",
                    transform: `translate(-50%, -50%) scale(${scale})`,
                }}
            />
        </span>
    );
}
