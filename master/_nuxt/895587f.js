(window.webpackJsonp=window.webpackJsonp||[]).push([[9],{532:function(t,n,e){var map={"./access-control-fr.md":328,"./analitycs-fr.md":329,"./api-fr.md":330,"./api-key-fr.md":331,"./api-stats-fr.md":332,"./back-office-fr.md":333,"./catalog-fr.md":334,"./connection-fr.md":335,"./connectors-fr.md":336,"./content-pages-fr.md":337,"./dataset-details-fr.md":338,"./dataset-management-fr.md":339,"./extensions-fr.md":340,"./home-fr.md":341,"./introduction-fr.md":342,"./licenses-fr.md":343,"./notify-fr.md":344,"./periodic-processings-fr.md":345,"./portal-config-fr.md":346,"./portal-fr.md":347,"./portal-notify-fr.md":348,"./reuse-fr.md":349,"./user-management-fr.md":350,"./visu-config-fr.md":351,"./visualization-fr.md":352,"./visualizations-page-fr.md":353};function r(t){var n=o(t);return e(n)}function o(t){if(!e.o(map,t)){var n=new Error("Cannot find module '"+t+"'");throw n.code="MODULE_NOT_FOUND",n}return map[t]}r.keys=function(){return Object.keys(map)},r.resolve=o,t.exports=r,r.id=532},555:function(t,n,e){"use strict";e.r(n);e(35),e(38),e(33),e(34),e(7),e(6);var r=e(326),o=e(532),c={computed:{sections:function(){if(this.$route){var t=o.keys().filter((function(t){return t.includes("-fr.md")})).map((function(t){return Object.assign(r(o(t).default).meta||{},{id:t.split("/")[1].split(".").shift().replace("-fr","")})}));return t.sort((function(t,n){return t.section<n.section?-1:t.section>n.section?1:t.subsection<n.subsection?-1:1})),t}}}},f=e(44),l=e(66),d=e.n(l),m=e(523),v=e(536),_=e(569),y=e(138),h=e(553),component=Object(f.a)(c,(function(){var t=this,n=t.$createElement,e=t._self._c||n;return e("v-container",{staticClass:"index-page"},[e("h2",{staticClass:"display-1 my-6"},[t._v("\n    Présentation fonctionnelle\n    "),e("v-btn",{attrs:{to:t.localePath({name:"full-functional-presentation"}),icon:""}},[e("v-icon",{attrs:{color:"primary"}},[t._v("\n        mdi-printer\n      ")])],1)],1),t._v(" "),t._l(t.sections.filter((function(s){return!s.subsection})),(function(section,i){return e("v-row",{key:i},[e("v-col",[e("nuxt-link",{staticClass:"headline",attrs:{to:t.localePath({name:"functional-presentation-id",params:{id:section.id}})}},[t._v("\n        "+t._s(i+1)+" - "+t._s(section.title)+"\n      ")]),t._v(" "),t._l(t.sections.filter((function(s){return s.section===section.section&&s.subsection})),(function(n,r){return e("v-row",{key:r,staticClass:"px-6"},[e("nuxt-link",{staticClass:"title",attrs:{to:t.localePath({name:"functional-presentation-id",params:{id:n.id}})}},[t._v("\n          "+t._s(i+1)+"."+t._s(r+1)+" - "+t._s(n.title)+"\n        ")])],1)}))],2)],1)}))],2)}),[],!1,null,null,null);n.default=component.exports;d()(component,{VBtn:m.a,VCol:v.a,VContainer:_.a,VIcon:y.a,VRow:h.a})}}]);