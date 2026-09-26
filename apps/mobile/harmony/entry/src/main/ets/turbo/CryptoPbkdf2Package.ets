import { TurboModulesFactory } from '@rnoh/react-native-openharmony/ts';
import { RNOHPackage } from '@rnoh/react-native-openharmony';
import type { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { CryptoPbkdf2TurboModule } from './CryptoPbkdf2TurboModule';

class CryptoPbkdf2TurboModuleFactory extends TurboModulesFactory {
  createTurboModule(name: string): TurboModule | null {
    if (this.hasTurboModule(name)) {
      return new CryptoPbkdf2TurboModule(this.ctx);
    }
    return null;
  }

  hasTurboModule(name: string): boolean {
    return name === 'CryptoPbkdf2';
  }
}

export class CryptoPbkdf2Package extends RNOHPackage {
  createTurboModulesFactory(ctx: TurboModuleContext): TurboModulesFactory {
    return new CryptoPbkdf2TurboModuleFactory(ctx);
  }
}
