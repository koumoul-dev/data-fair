<template>
  <v-row v-if="initialized" class="home my-0">
    <v-iframe v-if="missingSubscription" :src="env.subscriptionUrl" />
    <v-col v-else :style="this.$vuetify.breakpoint.lgAndUp ? 'padding-right:256px;' : ''">
      <v-container class="py-0">
        <v-responsive v-if="!user">
          <v-container class="fill-height">
            <v-row align="center">
              <v-col class="text-center">
                <h3 class="text-h4 mb-3 mt-5">
                  {{ $t('common.title') }}
                </h3>
                <layout-wrap-svg
                  :source="dataProcessSvg"
                  :color="$vuetify.theme.themes.light.primary"
                />
                <div v-if="!env.disableApplications && !env.disableRemoteServices" class="text-h6">
                  {{ $t('pages.root.description') }}
                </div>
                <p class="text-h6 mt-5">
                  {{ $t('common.authrequired') }}
                </p>
                <v-btn
                  color="primary"
                  @click="login"
                >
                  {{ $t('common.login') }}
                </v-btn>
              </v-col>
            </v-row>
          </v-container>
        </v-responsive>
        <v-row v-else>
          <v-col>
            <h2 class="mb-4">
              Espace de l'{{ activeAccount.type ==='organization' ? 'organisation' : 'utilisateur' }} {{ activeAccount.name }}
            </h2>
            <p v-if="activeAccount.type ==='organization'">
              Vous êtes <strong>{{ user.organizations.find(o => o.id===activeAccount.id).role }}</strong> dans cette organisation.
            </p>
            <p v-else-if="user.organizations.length">
              <v-icon color="warning">
                mdi-alert
              </v-icon>
              Pour travailler en <strong>mode collaboratif</strong> vous devez ouvrir le menu personnel (en haut à droite) et changer de compte actif.
              Pour créer une nouvelle organisation rendez vous sur <nuxt-link to="/me">
                votre compte.
              </nuxt-link>
            </p>
            <p v-else>
              Pour travailler en <strong>mode collaboratif</strong> vous devez créer une organisation. Pour cela rendez vous sur <nuxt-link to="/me">
                votre compte.
              </nuxt-link>
            </p>
            <p v-if="!env.disableApplications && !env.disableRemoteServices">
              {{ $t('pages.root.description') }}
            </p>
            <layout-section-tabs
              :min-height="390"
              :svg="dataSvg"
              svg-no-margin
              :section="sections.find(s => s.id === 'datasets')"
            >
              <template v-slot:extension>
                <p v-if="stats && datasets">
                  <span v-if="datasets.count > 1">
                    <nuxt-link to="/datasets">
                      {{ datasets.count.toLocaleString() }} jeux de données
                    </nuxt-link> ont déjà été créés dans votre espace.
                  </span>
                  <span v-else-if="datasets.count === 1">
                    <nuxt-link to="/datasets">
                      1 jeu de données
                    </nuxt-link> a déjà été créé dans votre espace.
                  </span>
                  <span v-else>
                    Aucun jeu de donnée n'a été créé pour l'instant dans votre espace.
                  </span>
                  <span>
                    Vous utilisez {{ stats.storage | displayBytes }}{{ (stats.storageLimit && stats.storageLimit !== -1) ? '' : ' de stockage.' }}
                  </span>
                  <span v-if="stats.storageLimit && stats.storageLimit !== -1">
                    sur un total disponible de {{ stats.storageLimit | displayBytes }}.
                  </span>
                </p>
              </template>
              <template v-slot:tabs-items>
                <v-container fluid class="py-0 px-2">
                  <v-row>
                    <v-col
                      cols="12"
                      sm="6"
                      md="7"
                    >
                      <storage-treemap
                        v-if="stats && datasets"
                        :stats="stats"
                        :datasets="datasets"
                      />
                    </v-col>
                    <v-col
                      cols="12"
                      sm="6"
                      md="5"
                    >
                      <dataset-list-actions />
                    </v-col>
                  </v-row>
                </v-container>
              </template>
            </layout-section-tabs>

            <layout-section-tabs
              v-if="!env.disableApplications"
              :min-height="400"
              :svg="graphicSvg"
              :section="sections.find(s => s.id === 'apps')"
            >
              <template v-slot:extension>
                <p v-if="stats">
                  <span v-if="stats.applications > 1">
                    <nuxt-link to="/applications">
                      {{ stats.applications.toLocaleString() }} visualisations
                    </nuxt-link> ont déjà été configurées dans votre espace.
                  </span>
                  <span v-else-if="stats.applications=== 1">
                    <nuxt-link to="/applications">
                      1 visualisation
                    </nuxt-link> a déjà été configurée dans votre espace.
                  </span>
                  <span v-else>
                    Aucune visualisation n'a été configurée pour l'instant dans votre espace.
                  </span>
                  <span v-if="baseApps">
                    Vous avez accès à {{ baseApps.length.toLocaleString() }} applications pour configurer autant de visualisations que vous le souhaitez.
                  </span>
                </p>
              </template>
              <template v-slot:tabs-items>
                <v-container fluid>
                  <v-row v-if="baseApps">
                    <v-spacer />
                    <v-carousel
                      cycle
                      style="max-width:510px;"
                      hide-delimiters
                      show-arrows
                    >
                      <v-carousel-item
                        v-for="(app, i) in baseApps"
                        :key="i"
                      >
                        <div style="position:relative">
                          <v-sheet
                            style="position:absolute;top:0;left:0;right:0;z-index:1;"
                            flat
                            color="rgba(0, 0, 0, 0.6)"
                            class="pa-2"
                            dark
                          >
                            {{ app.title }}
                          </v-sheet>
                          <v-img
                            :src="app.image"
                            height="340"
                            contain
                          />
                          <v-sheet
                            v-if="app.description"
                            style="position:absolute;bottom:0;left:0;right:0;z-index:1;"
                            flat
                            color="rgba(0, 0, 0, 0.6)"
                            class="pa-2"
                            dark
                          >
                            {{ app.description }}
                          </v-sheet>
                        </div>
                      </v-carousel-item>
                    </v-carousel>
                    <v-spacer />
                  </v-row>
                </v-container>
              </template>
            </layout-section-tabs>
          </v-col>
        </v-row>
      </v-container>
    </v-col>

    <layout-navigation-right v-if="this.$vuetify.breakpoint.lgAndUp">
      <activity v-if="activity" :activity="activity" />
    </layout-navigation-right>
  </v-row>
</template>

<script>
  import 'iframe-resizer/js/iframeResizer'
  import VIframe from '@koumoul/v-iframe'

  const { mapState, mapActions, mapGetters } = require('vuex')

  export default {
    components: { VIframe },
    data: () => ({
      stats: null,
      datasets: null,
      baseApps: null,
      activity: null,
      headers: [
        { text: '', value: 'name', sortable: false },
        { text: 'Nombre de jeux de données', value: 'datasets', sortable: false },
        { text: 'Espace consommé', value: 'storage', sortable: false },
        { text: 'Espace total disponible', value: 'storageLimit', sortable: false },
        { text: 'Nombre d\'applications', value: 'applications', sortable: false },
      ],
      dataSvg: require('~/assets/svg/Data Arranging_Two Color.svg?raw'),
      graphicSvg: require('~/assets/svg/Graphics and charts_Monochromatic.svg?raw'),
      dataProcessSvg: require('~/assets/svg/Data Process_Two Color.svg?raw'),
    }),
    computed: {
      ...mapState('session', ['user', 'initialized']),
      ...mapState(['env']),
      ...mapGetters(['missingSubscription']),
      ...mapGetters('session', ['activeAccount']),
      sections() {
        return [
          { id: 'datasets', title: 'Jeux de données' },
          { id: 'apps', title: 'Visualisations' },
        ]
      },
    },
    async created() {
      if (!this.user) return
      this.$store.dispatch('breadcrumbs', [{ text: 'Partage et visualisation de données' }])

      this.stats = await this.$axios.$get('api/v1/stats')

      const owner = `${this.activeAccount.type}:${this.activeAccount.id}`
      this.activity = await this.$axios.$get('api/v1/activity', {
        params: { size: 8, owner },
      })

      this.datasets = await this.$axios.$get('api/v1/datasets', {
        params: { size: 11, owner: owner, select: 'id,title,storage', sort: 'storage.size:-1' },
      })

      this.baseApps = (await this.$axios.$get('api/v1/base-applications', {
        params: { size: 10000, privateAccess: owner, select: 'title,image' },
      })).results
    },
    methods: {
      ...mapActions('session', ['login']),
    },
  }
</script>

<style lang="css">
.data-fair a {
  text-decoration: none;
}
</style>
