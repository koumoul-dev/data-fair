<template>
  <div class="applications-facets">
    <template v-if="facets.owner">
      <v-select
        v-model="facetsValues.owner"
        multiple
        label="Propriétaire"
        :items="facets.owner"
        :item-value="item => `${item.value.type}:${item.value.id}`"
        :item-text="item => `${item.value.name} (${item.count})`"
        hide-details
        rounded
        class="mb-4 mt-0 pt-0"
        background-color="admin"
        dark
      />
    </template>

    <template v-if="facets.visibility && !env.disableSharing">
      <v-select
        v-model="facetsValues.visibility"
        multiple
        label="Visibilité"
        :items="facets.visibility"
        item-value="value"
        :item-text="item => `${{public: 'Public', private: 'Privé', protected: 'Protégé'}[item.value]} (${item.count})`"
        outlined
        dense
        hide-details
        rounded
        class="mb-4"
      />
    </template>

    <template v-if="facets.topics">
      <v-select
        v-model="facetsValues.topics"
        multiple
        label="Thématiques"
        :items="facets.topics"
        :item-value="item => item.value.id"
        :item-text="item => `${item.value.title} (${item.count})`"
        outlined
        dense
        hide-details
        rounded
        class="mb-4"
      />
    </template>

    <template v-if="facets.publicationSites && facets.publicationSites.find(item => item.value !== null)">
      <v-select
        v-model="facetsValues.publicationSites"
        multiple
        label="Portails"
        :items="facets.publicationSites"
        :item-value="item => item.value || 'null'"
        :item-text="item => publicationSiteText(item)"
        outlined
        dense
        hide-details
        rounded
        class="mb-4"
      />
    </template>

    <template v-if="facets['base-application']">
      <v-select
        v-model="facetsValues['base-application']"
        multiple
        label="Application"
        :items="facets['base-application']"
        :item-value="item => item.value.url"
        :item-text="item => `${item.value.title} ${item.value.version || ''} (${item.count})`"
        outlined
        dense
        hide-details
        rounded
        class="mb-4"
      />
    </template>
  </div>
</template>

<script>
  import { mapState, mapGetters } from 'vuex'

  export default {
    props: ['facets', 'facetsValues'],
    data() {
      return { visibleFacet: 'visibility' }
    },
    computed: {
      ...mapState(['vocabulary', 'env']),
      ...mapGetters(['activeAccountPublicationSitesById']),
    },
    methods: {
      publicationSiteText(item) {
        let title = item.value
        if (item.value === null) title = 'aucun'
        else {
          const publicationSite = this.activeAccountPublicationSitesById && this.activeAccountPublicationSitesById[item.value]
          if (publicationSite) {
            title = publicationSite.title || publicationSite.url || publicationSite.id
          }
        }
        return `${title} (${item.count})`
      },
    },
  }
</script>

<style lang="less">
  .applications-facets {
    .v-subheader {
      cursor: pointer;
    }
    .v-subheader:not(:first-child) {
      margin-top: 16px;
    }
    .v-subheader {
      padding-left: 0;
      height: 20px;
    }
  }

</style>
