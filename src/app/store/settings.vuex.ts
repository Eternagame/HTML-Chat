import { ActionTree, MutationTree, CommitOptions } from 'vuex';
import * as Irc from 'irc-framework';
import {
  createModule, mutation, action, extractVuexModule,
} from 'vuex-class-component';
import Vue from 'vue';
import { Watch } from 'vue-property-decorator';

const VuexModule = createModule({
  strict: false,
});
export default class SettingsModule extends VuexModule {
  fontSize: Number = 14;

  indicator: string = ' (!)';

  allChatFeatures = true;

  emoticonChatFeatures = true;

  markdownChatFeatures = true;

  previewChatFeatures = true;

  awayReason = '';

  typingMessages = true;

  created() {
    if (localStorage) {
      if (localStorage.chat_typingMessages) {
        this.typingMessages = JSON.parse(localStorage.chat_typingMessages);
      }
    }
  }
}
