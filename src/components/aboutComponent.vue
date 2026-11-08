<script setup>
  import { RVCAT_VERSION } from '@/common'
  import { t } from '@/i18n'
</script>

<template>
  <div class='main'>
      <p v-html="t('about.intro')"></p>
      <p><strong>{{ t('Version {v}', { v: RVCAT_VERSION }) }}</strong></p>
      <p v-html="t('about.authors')"></p>
      <p>{{ t('about.contact') }}</p>
      <p>{{ t('about.thanks') }}</p>
      <p><b>{{ t('The RVCAT developers © 2026') }}</b></p>
    </div>
</template>

<style scoped>
  .main{
    height: 100%;
    width: 100%;
    background: white;
    overflow: auto;
    padding: 5px;
    border-radius: 10px;
    position: relative;
  }
</style>
