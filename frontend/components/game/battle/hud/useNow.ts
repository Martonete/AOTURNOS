import { useEffect, useState } from "react";

/** Reloj compartido por los contadores del HUD (reloj de arena del turno). */
export function useNow(intervalMs = 200): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}
