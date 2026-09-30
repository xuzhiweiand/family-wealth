import { TurboModulesFactory } from '@rnoh/react-native-openharmony/ts';
import { RNOHPackage } from '@rnoh/react-native-openharmony';
import type { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { ReminderAgentTurboModule } from './ReminderAgentTurboModule';

class ReminderAgentTurboModuleFactory extends TurboModulesFactory {
  createTurboModule(name: string): TurboModule | null {
    if (this.hasTurboModule(name)) {
      return new ReminderAgentTurboModule(this.ctx);
    }
    return null;
  }

  hasTurboModule(name: string): boolean {
    return name === 'ReminderAgent';
  }
}

export class ReminderAgentPackage extends RNOHPackage {
  createTurboModulesFactory(ctx: TurboModuleContext): TurboModulesFactory {
    return new ReminderAgentTurboModuleFactory(ctx);
  }
}
