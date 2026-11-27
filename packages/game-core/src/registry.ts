import type { GameMetadata, GamePluginDescriptor } from './plugin';

export class GameRegistry<TEntry extends GamePluginDescriptor = GamePluginDescriptor> {
  private readonly entries = new Map<string, TEntry>();

  register(entry: TEntry): void {
    const id = entry.metadata.id.trim();
    if (!id) {
      throw new Error('Cannot register a game plugin without a non-empty metadata.id.');
    }
    if (this.entries.has(id)) {
      throw new Error(`Game plugin "${id}" is already registered.`);
    }
    this.entries.set(id, entry);
  }

  unregister(gameId: string): boolean {
    return this.entries.delete(gameId);
  }

  has(gameId: string): boolean {
    return this.entries.has(gameId);
  }

  get(gameId: string): TEntry | undefined {
    return this.entries.get(gameId);
  }

  list(): readonly TEntry[] {
    return Array.from(this.entries.values());
  }

  listMetadata(): readonly GameMetadata[] {
    return this.list().map((entry) => entry.metadata);
  }
}

export function createGameRegistry<
  TEntry extends GamePluginDescriptor = GamePluginDescriptor,
>(): GameRegistry<TEntry> {
  return new GameRegistry<TEntry>();
}
