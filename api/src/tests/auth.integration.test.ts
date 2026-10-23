import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    type SessionPayload,
    buildCharacterName,
    connectCharacter,
    createAccountFixture,
    createCharacter,
    createCharacterFixture,
    deleteCharacter,
    disconnectCharacter,
    ensureApiReady,
    expectErrorPayload,
    expectSuccessPayload,
    getAuthMe,
    getAuthSession,
    loginAccount,
    logoutSession,
    patchCharacter,
    requestJson,
    selectCharacterRequest,
    uniqueLetters,
} from "./helpers/api";

beforeAll(async () => {
    await ensureApiReady();
});

test("register, session, me and logout keep auth state consistent", async () => {
    const account = await createAccountFixture();

    const sessionResponse = await getAuthSession(account.session.sessionToken);
    const meResponse = await getAuthMe(account.session.sessionToken);

    assert.equal(sessionResponse.status, 200);
    assert.equal(meResponse.status, 200);
    assert.equal(
        expectSuccessPayload<SessionPayload>(sessionResponse.data).account.email,
        account.email,
    );
    assert.equal(
        expectSuccessPayload<SessionPayload>(meResponse.data).account.name,
        account.name,
    );

    const logoutResponse = await logoutSession(account.session.sessionToken);
    assert.equal(logoutResponse.status, 200);
    assert.equal((logoutResponse.data as { ok?: boolean }).ok, true);

    const expiredSession = await getAuthSession(account.session.sessionToken);
    assert.equal(expiredSession.status, 401);
});

test("login accepts email or display name and rejects invalid passwords", async () => {
    const account = await createAccountFixture();

    const byEmail = await loginAccount(account.email, account.password);
    const byName = await loginAccount(account.name, account.password);
    const invalid = await loginAccount(
        account.email,
        `${account.password}-bad`,
    );

    assert.equal(byEmail.status, 200);
    assert.equal(byName.status, 200);
    assert.equal(invalid.status, 401);
    assert.equal(
        expectErrorPayload(invalid.data).error,
        "Credenciales invalidas",
    );
});

test("register rejects duplicate email and duplicate display name", async () => {
    const account = await createAccountFixture();

    const duplicateEmail = await requestJson<{ error?: string }>(
        "/auth/register",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: `Otro ${account.name}`.slice(0, 15),
                email: account.email,
                password: account.password,
            }),
        },
    );
    const duplicateName = await requestJson<{ error?: string }>(
        "/auth/register",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: account.name,
                email: `other-${Date.now()}@local.test`,
                password: account.password,
            }),
        },
    );

    assert.equal(duplicateEmail.status, 409);
    assert.equal(duplicateName.status, 409);
});

test("create, select and delete character updates the public session", async () => {
    const account = await createAccountFixture();
    const characterName = `Hero ${uniqueLetters(4)}`.slice(0, 15);
    const created = await createCharacter(
        account.session.sessionToken,
        characterName,
    );
    const characterId = created.characters.find(
        (entry) => entry.name === characterName,
    )?._id;

    assert.ok(characterId, "No se creó el personaje en la sesión");

    const selected = await selectCharacterRequest(
        account.session.sessionToken,
        characterId,
    );
    assert.equal(selected.status, 200);
    assert.equal(
        expectSuccessPayload<SessionPayload>(selected.data).selectedCharacterId,
        characterId,
    );

    const deleted = await deleteCharacter(
        account.session.sessionToken,
        characterId,
    );
    assert.equal(deleted.status, 200);
    const deletedSession = expectSuccessPayload<SessionPayload>(deleted.data);
    assert.equal(
        deletedSession.characters.some((entry) => entry._id === characterId),
        false,
    );
    assert.equal(deletedSession.selectedCharacterId ?? null, null);
});

test("select-character rejects characters owned by another account", async () => {
    const owner = await createCharacterFixture({ namePrefix: "SelA" });
    const intruder = await createAccountFixture();

    const response = await selectCharacterRequest(
        intruder.session.sessionToken,
        owner.id,
    );

    assert.equal(response.status, 400);
    assert.equal(
        expectErrorPayload(response.data).error,
        "Personaje invalido",
    );
});

test("delete-character rejects connected characters", async () => {
    const owner = await createCharacterFixture({ namePrefix: "Conn" });

    const connectResponse = await connectCharacter(owner.id);
    assert.equal(connectResponse.status, 200);

    const deleted = await deleteCharacter(owner.sessionToken, owner.id);
    assert.equal(deleted.status, 409);
    assert.equal(
        expectErrorPayload(deleted.data).error,
        "No se puede borrar un personaje conectado",
    );

    const disconnectResponse = await disconnectCharacter(owner.id);
    assert.equal(disconnectResponse.status, 200);
});

test("delete-character rejects banned characters", async () => {
    const owner = await createCharacterFixture({ namePrefix: "Bann" });

    await patchCharacter(owner.id, {
        banned: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const deleted = await deleteCharacter(owner.sessionToken, owner.id);
    assert.equal(deleted.status, 403);
    assert.equal(
        expectErrorPayload(deleted.data).error,
        "No se puede borrar un personaje baneado",
    );
});

test("create-character only accepts the four playable classes", async () => {
    const account = await createAccountFixture();

    for (const blockedClass of ["guerrero", "asesino", "bardo", "druida"]) {
        const response = await requestJson("/auth/create-character", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${account.session.sessionToken}`,
            },
            body: JSON.stringify({
                name: buildCharacterName("Cls"),
                class: blockedClass,
                race: "humano",
                gender: "male",
                headId: 1,
            }),
        });
        assert.equal(response.status, 400, blockedClass);
    }

    for (const playableClass of ["mago", "paladin", "clerigo", "cazador"]) {
        const response = await requestJson("/auth/create-character", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${account.session.sessionToken}`,
            },
            body: JSON.stringify({
                name: buildCharacterName("Cls"),
                class: playableClass,
                race: "humano",
                gender: "male",
                headId: 1,
            }),
        });
        assert.equal(response.ok, true, `${playableClass}: ${JSON.stringify(response.data)}`);
    }
});
