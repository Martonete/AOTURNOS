import { createElement } from "react";
import type { Combatant } from "@aoturnos/game-core";
import type { LucideProps } from "lucide-react";
import { unitEmblem } from "./flavor";

/** Emblema de clase o familia de un combatiente, como componente estable. */
export function UnitEmblem({ unit, ...props }: { unit: Combatant } & LucideProps) {
    return createElement(unitEmblem(unit), props);
}
