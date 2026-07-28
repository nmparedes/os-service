import { AuthModule } from "../../src/auth/auth.module";

describe("AuthModule", () => {
  it("is defined for JWT validation wiring", () => {
    expect(AuthModule).toBeDefined();
  });
});
