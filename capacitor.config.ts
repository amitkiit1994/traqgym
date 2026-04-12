import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.traqgym.app",
  appName: "TraqGym",
  webDir: "out",
  server: {
    url: "https://freeformfitness.traqgym.com",
    cleartext: false,
  },
};

export default config;
