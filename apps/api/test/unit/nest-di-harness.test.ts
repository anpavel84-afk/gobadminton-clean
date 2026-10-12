import "reflect-metadata";
import { Controller, Get, Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

@Injectable()
class Dep {
  ping(): string {
    return "ok";
  }
}

@Controller("x")
class C {
  constructor(private readonly dep: Dep) {}

  @Get()
  hit(): string {
    return this.dep.ping();
  }
}

@Module({ controllers: [C], providers: [Dep] })
class M {}

describe("Nest DI harness under Vitest", () => {
  it("injects class-token constructor deps (requires decorator metadata)", async () => {
    const paramtypes = Reflect.getMetadata("design:paramtypes", C) as
      | unknown[]
      | undefined;
    const ref = await Test.createTestingModule({ imports: [M] }).compile();
    const controller = ref.get(C);
    expect(paramtypes?.[0]).toBe(Dep);
    expect(controller.hit()).toBe("ok");
  });
});
