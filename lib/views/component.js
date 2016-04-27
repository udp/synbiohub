
var getComponentDefinition = require('../get-sbol').getComponentDefinition
var getComponentDefinitionMetadata = require('../get-sbol').getComponentDefinitionMetadata

var stack = require('../stack');

var sbolmeta = require('sbolmeta')

var formatSequence = require('sequence-formatter')

var async = require('async')

var prefixify = require('../prefixify')

var pug = require('pug')

var base64 = require('../base64')

var sparql = require('../sparql-collate')

module.exports = function(req, res) {

	var locals = {
        section: 'component',
        user: req.user
    }

    // todo check the prefix is real
    //req.params.prefix
    //req.params.designid

    var prefixes
    var baseUri
    var uri

    var meta

    var encodedProteins = []
    var collections = []

    var otherComponents = []
    var mappings = {}

    var stores = [
        stack.getDefaultStore()
    ]

    if(req.userStore)
        stores.push(req.userStore)

    async.series([

        function getPrefixes(next) {

            if(req.params.prefix) {

                stack.getPrefixes((err, p) => {

                    prefixes = p
                    baseUri = prefixes[req.params.prefix]
                    uri = baseUri + req.params.designid

                    next(err)
                })

            } else {

                uri = base64.decode(req.params.designURI)

                next()

            }

        },

        function retrieveSBOL(next) {

            getComponentDefinition(null, uri, stores, function(err, sbol, componentDefinition) {

                if(err) {

                    next(err)

                } else {

                    if(!componentDefinition) {
                        return res.status(404).send('not found\n' + uri)
                    }

                    meta = sbolmeta.summarizeComponentDefinition(componentDefinition)
                    next()
                }
            })

        },

        function lookupEncodedProteins(next) {

            var query =
                'PREFIX sybio: <http://www.sybio.ncl.ac.uk#>\n' +
            'SELECT ?subject WHERE {' +
                '   ?subject sybio:en_by <' + uri + '>' +
                '}'

            sparql(stores, query, (err, results) => {

                if(err) {

                    next(err)

                } else {

                    console.log(results)

                    encodedProteins = results.map((result) => {
                        return result.subject
                    })

                    next()

                }
            })

        },

        function lookupCollections(next) {

            var query =
                'PREFIX sbol2: <http://sbols.org/v2#>\n' +
                'PREFIX dcterms: <http://purl.org/dc/terms/>\n' +
            'SELECT ?subject ?title WHERE {' +
                '   ?subject a sbol2:Collection .' +
                '   ?subject sbol2:member <' + uri + '> .' +
                '   ?subject dcterms:title ?title .' +
                '}'

            sparql(stores, query, (err, results) => {

                if(err) {

                    next(err)

                } else {

                    collections = results.map((result) => {
                        return {
                            uri: result.subject,
                            url: '/collection/' + base64.encode(result.subject),
                            name: result.title
                        }
                    })

                    next()

                }
            })

        },

        function getOtherComponentMetaData(next) {

            if(meta.protein && meta.protein.encodedBy)
                otherComponents = otherComponents.concat(meta.protein.encodedBy)
                        /* todo and subcomponents */

            otherComponents = otherComponents.concat(encodedProteins)

            async.map(otherComponents, (uri, next) => {

    //<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:prov="http://www.w3.org/ns/prov#" xmlns:sbol="http://sbols.org/v2#" xmlns:sybio="http://www.sybio.ncl.ac.uk#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:ncbi="http://www.ncbi.nlm.nih.gov#">

                getComponentDefinitionMetadata(null, uri, stores, (err, metadata) => {

                    console.log('md for ' + uri)
                    console.log(metadata)

                    next(null, {
                        uri: uri,
                        name: metadata[0].name
                    })

                })

            }, (err, componentNameMappings) => {

                if(err) {

                    next(err)

                } else {

                    componentNameMappings.forEach((mapping) => {
                        mappings[mapping.uri] = mapping.name
                    })

                    next()
                     
                }
            })

        },

        function renderView() {

            locals.meta = meta

            locals.sbolUrl = req.params.designid + '.xml'
            locals.fastaUrl = req.params.designid + '.fasta'
            locals.keywords = []
            locals.citations = []
            locals.prefix = req.params.prefix

            locals.encodedProteins = encodedProteins.map((uri) => {

                var prefixified = prefixify(uri, prefixes)

                return {
                    uri: uri,
                    name: mappings[uri],
                    url: '/entry/' + prefixified.prefix + '/' + prefixified.uri
                }

            })

            locals.collections = collections

            locals.meta.sequences.forEach((sequence) => {

                sequence.formatted = formatSequence(sequence.elements)

                sequence.blastUrl = sequence.type === 'AminoAcid' ?
                    'http://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=blastp&PAGE_TYPE=BlastSearch&LINK_LOC=blasthome' :
                    'http://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=blastn&PAGE_TYPE=BlastSearch&LINK_LOC=blasthome'

            })

            locals.meta.description = locals.meta.description.split(';').join('<br/>')

            if(locals.meta.protein) {

                if(locals.meta.protein.encodedBy) {

                    locals.meta.protein.encodedBy = locals.meta.protein.encodedBy.map((uri) => {

                        var prefixified = prefixify(uri, prefixes)

                        return {
                            uri: uri,
                            name: mappings[uri],
                            url: '/entry/' + prefixified.prefix + '/' + prefixified.uri
                        }

                    })

                }
            }

            res.send(pug.renderFile('templates/views/component.jade', locals))
        }
    ])
	
};

