import React from "react";
import type { Block } from "../types";

export type BlockRenderer<T extends Block = Block> = (block: T) => React.ReactNode;

export class BlockRendererRegistry {
  private map = new Map<Block["type"], BlockRenderer<any>>();

  register<TType extends Block["type"]>(
    type: TType,
    renderer: BlockRenderer<Extract<Block, { type: TType }>>
  ) {
    this.map.set(type, renderer as BlockRenderer<any>);
  }

  render(block: Block): React.ReactNode {
    const r = this.map.get(block.type);
    if (!r) {
      return (
        <div className="block-unknown">
          <div className="muted">[no renderer]</div>
          <pre className="code">{JSON.stringify(block, null, 2)}</pre>
        </div>
      );
    }
    return r(block as any);
  }
}
