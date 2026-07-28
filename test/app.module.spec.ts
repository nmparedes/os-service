import { AppModule } from "../src/app.module";

describe("AppModule", () => {
  it("is defined for the OS service bootstrap", () => {
    expect(AppModule).toBeDefined();
  });
});
