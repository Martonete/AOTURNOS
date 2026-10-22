import { Container, Filter, GlProgram, Sprite, Texture } from "pixi.js";

/* ------------------------------------------------------------------ */
/* Post-proceso: viñeta, gradación de color, aberración cromática,     */
/* destello y onda de choque, en un solo filtro de pantalla completa.  */
/* ------------------------------------------------------------------ */

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform highp vec4 uOutputTexture;
void main(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec3 uTint;
uniform float uVignette;
uniform float uAberration;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform vec2 uShockCenter;
uniform float uShockRadius;
uniform float uShockStrength;
uniform float uSaturation;

void main(void) {
    vec2 uv = vTextureCoord;
    vec2 pixel = uv * uInputSize.xy + uOutputFrame.xy;

    // Onda de choque: un anillo que desplaza las coordenadas hacia afuera.
    if (uShockStrength > 0.0) {
        vec2 delta = pixel - uShockCenter;
        float dist = length(delta);
        float ring = 1.0 - smoothstep(0.0, 28.0, abs(dist - uShockRadius));
        uv += normalize(delta + 0.0001) * ring * uShockStrength * uInputSize.zw * 18.0;
    }

    vec4 color = texture(uTexture, uv);
    if (uAberration > 0.0) {
        vec2 dir = (uv - 0.5) * uAberration * uInputSize.zw * 6.0;
        color.r = texture(uTexture, uv + dir).r;
        color.b = texture(uTexture, uv - dir).b;
    }

    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(luma), color.rgb, uSaturation);
    color.rgb *= uTint;

    vec2 screen = (pixel - uOutputFrame.xy) / max(uOutputFrame.zw, vec2(1.0));
    float vig = smoothstep(0.85, 0.25, distance(screen, vec2(0.5)));
    color.rgb *= mix(1.0, vig, uVignette);

    color.rgb = mix(color.rgb, uFlashColor, uFlash);
    finalColor = color;
}`;

export class BattlePostFx {
    readonly filter: Filter;
    private shockT = 1;
    private shockDuration = 1;
    private flashT = 0;
    private aberrationT = 0;

    constructor() {
        this.filter = new Filter({
            glProgram: GlProgram.from({ vertex, fragment, name: "aoturnos-battle-postfx" }),
            resources: {
                postUniforms: {
                    uTint: { value: new Float32Array([1.02, 0.98, 1.06]), type: "vec3<f32>" },
                    uVignette: { value: 0.55, type: "f32" },
                    uAberration: { value: 0, type: "f32" },
                    uFlash: { value: 0, type: "f32" },
                    uFlashColor: { value: new Float32Array([1, 0.9, 0.7]), type: "vec3<f32>" },
                    uShockCenter: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
                    uShockRadius: { value: 0, type: "f32" },
                    uShockStrength: { value: 0, type: "f32" },
                    uSaturation: { value: 1.08, type: "f32" },
                },
            },
        });
    }

    private get uniforms() {
        return (this.filter.resources.postUniforms as { uniforms: Record<string, any> }).uniforms;
    }

    /** Coordenadas en píxeles de pantalla (del canvas). */
    shockwave(x: number, y: number, durationMs = 650): void {
        const u = this.uniforms;
        u.uShockCenter[0] = x;
        u.uShockCenter[1] = y;
        this.shockT = 0;
        this.shockDuration = durationMs;
    }

    flash(color: [number, number, number], strength = 0.45): void {
        const u = this.uniforms;
        u.uFlashColor[0] = color[0];
        u.uFlashColor[1] = color[1];
        u.uFlashColor[2] = color[2];
        this.flashT = strength;
    }

    aberration(strength = 1): void {
        this.aberrationT = Math.max(this.aberrationT, strength);
    }

    setMood(tint: [number, number, number], saturation = 1.08): void {
        const u = this.uniforms;
        u.uTint[0] = tint[0];
        u.uTint[1] = tint[1];
        u.uTint[2] = tint[2];
        u.uSaturation = saturation;
    }

    update(deltaMs: number): void {
        const u = this.uniforms;
        if (this.shockT < 1) {
            this.shockT = Math.min(1, this.shockT + deltaMs / this.shockDuration);
            u.uShockRadius = this.shockT * 260;
            u.uShockStrength = (1 - this.shockT) * 1.2;
        } else {
            u.uShockStrength = 0;
        }
        this.flashT = Math.max(0, this.flashT - deltaMs / 400);
        u.uFlash = this.flashT;
        this.aberrationT = Math.max(0, this.aberrationT - deltaMs / 500);
        u.uAberration = this.aberrationT;
    }
}

/* ------------------------------------------------------------------ */
/* Texturas procedurales                                               */
/* ------------------------------------------------------------------ */

let glowTexture: Texture | null = null;

/** Disco con caída suave, base de luces, partículas y destellos. */
export function getGlowTexture(): Texture {
    if (glowTexture) return glowTexture;
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.75)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.18)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    glowTexture = Texture.from(canvas);
    return glowTexture;
}

/* ------------------------------------------------------------------ */
/* Partículas aditivas con pool                                        */
/* ------------------------------------------------------------------ */

type Particle = {
    sprite: Sprite;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    gravity: number;
    startScale: number;
    endScale: number;
};

export type BurstOptions = {
    count: number;
    color: number;
    speed: [number, number];
    life: [number, number];
    scale: [number, number];
    gravity?: number;
    spread?: number;
    angle?: number;
};

export class ParticleSystem {
    readonly view = new Container();
    private live: Particle[] = [];
    private pool: Sprite[] = [];

    constructor(private readonly maxParticles = 1500) {
        this.view.blendMode = "add";
    }

    burst(x: number, y: number, o: BurstOptions): void {
        for (let i = 0; i < o.count && this.live.length < this.maxParticles; i++) {
            const sprite = this.pool.pop() ?? new Sprite(getGlowTexture());
            sprite.anchor.set(0.5);
            sprite.tint = o.color;
            sprite.alpha = 1;
            sprite.position.set(x, y);
            this.view.addChild(sprite);
            const angle = (o.angle ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
            const speed = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
            const life = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
            const startScale = o.scale[0] + Math.random() * (o.scale[1] - o.scale[0]);
            this.live.push({
                sprite,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life,
                maxLife: life,
                gravity: o.gravity ?? 0,
                startScale,
                endScale: startScale * 0.2,
            });
        }
    }

    update(deltaMs: number): void {
        const dt = deltaMs / 1000;
        for (let i = this.live.length - 1; i >= 0; i--) {
            const p = this.live[i];
            p.life -= deltaMs;
            if (p.life <= 0) {
                this.view.removeChild(p.sprite);
                this.pool.push(p.sprite);
                this.live.splice(i, 1);
                continue;
            }
            p.vy += p.gravity * dt;
            p.sprite.x += p.vx * dt;
            p.sprite.y += p.vy * dt;
            const t = p.life / p.maxLife;
            p.sprite.alpha = Math.min(1, t * 1.6);
            p.sprite.scale.set(p.endScale + (p.startScale - p.endScale) * t);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Luz 2D: luces aditivas sobre un ambiente oscuro, multiplicado        */
/* sobre el mundo desde una RenderTexture.                              */
/* ------------------------------------------------------------------ */

export type Light = { sprite: Sprite; baseAlpha: number; flicker: number; life?: number; maxLife?: number };

export class LightLayer {
    /** Contenido que se dibuja en la textura de luz cada cuadro. */
    readonly scene = new Container();
    private readonly ambient: Sprite;
    private readonly lights = new Set<Light>();
    private clock = 0;

    /** `pad` permite luces fuera del borde: la textura cubre desde (-pad, -pad). */
    constructor(width: number, height: number, ambient = 0x5a6488, pad = 0) {
        this.ambient = new Sprite(Texture.WHITE);
        this.ambient.position.set(-pad, -pad);
        this.scene.position.set(pad, pad);
        this.ambient.width = width;
        this.ambient.height = height;
        this.ambient.tint = ambient;
        this.scene.addChild(this.ambient);
    }

    resize(width: number, height: number): void {
        this.ambient.width = width;
        this.ambient.height = height;
    }

    setAmbient(color: number): void {
        this.ambient.tint = color;
    }

    add(x: number, y: number, radius: number, color: number, opts: { alpha?: number; flicker?: number; lifeMs?: number } = {}): Light {
        const sprite = new Sprite(getGlowTexture());
        sprite.anchor.set(0.5);
        sprite.position.set(x, y);
        sprite.width = radius * 2;
        sprite.height = radius * 2;
        sprite.tint = color;
        sprite.blendMode = "add";
        sprite.alpha = opts.alpha ?? 1;
        this.scene.addChild(sprite);
        const light: Light = { sprite, baseAlpha: opts.alpha ?? 1, flicker: opts.flicker ?? 0, life: opts.lifeMs, maxLife: opts.lifeMs };
        this.lights.add(light);
        return light;
    }

    remove(light: Light): void {
        this.lights.delete(light);
        light.sprite.destroy();
    }

    update(deltaMs: number): void {
        this.clock += deltaMs;
        for (const light of [...this.lights]) {
            if (light.life !== undefined && light.maxLife) {
                light.life -= deltaMs;
                if (light.life <= 0) {
                    this.remove(light);
                    continue;
                }
                light.sprite.alpha = light.baseAlpha * (light.life / light.maxLife);
                continue;
            }
            if (light.flicker > 0) {
                const n = Math.sin(this.clock / 90 + light.sprite.x) * 0.5 + Math.sin(this.clock / 37 + light.sprite.y) * 0.5;
                light.sprite.alpha = light.baseAlpha * (1 - light.flicker * 0.5 + n * light.flicker * 0.5);
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* Easing                                                              */
/* ------------------------------------------------------------------ */

export const ease = {
    inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
    outBack: (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
    inQuad: (t: number) => t * t,
};
