<template>
  <div class="svg-wrap" v-html="themedSource" />
</template>

<script>
  export default {
    props: {
      source: { type: String, required: true },
      color: { type: String },
      secondaryColor: { type: String },
    },
    computed: {
      themedSource() {
        if (!this.color) return this.source
        return this.source
          .replace(/#6C63FF/gi, this.color) // default undraw color
          .replace(/#68E1FD/gi, this.color) // default manypixels color
          .replace(/#FFD200/gi, this.secondaryColor || this.$vuetify.theme.themes.light.accent)
      },
    },
  }
</script>

<style lang="css">
div.svg-wrap {
  height: 100%;
}
div.svg-wrap svg {
  height: inherit;
  width: inherit;
}
</style>
