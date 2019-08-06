/* eslint-disable consistent-return */
const chalk = require('chalk');
const _ = require('lodash');
const path = require('path');
const EntityServerGenerator = require('generator-jhipster/generators/entity-server');
const writeFiles = require('./files').writeFiles;

const JHIPSTER_CONFIG_DIR = '.jhipster';

const defaultIdField = {
    name: 'id',
    fieldName: 'id',
    fieldType: 'Long',
    fieldNameAsDatabaseColumn: 'id',
    fieldNameUnderscored: 'id',
    fieldInJavaBeanMethod: 'Id',
    fieldValidate: false,
    fieldValidateRules: [],
    options: { id: true }
};

module.exports = class extends EntityServerGenerator {
    constructor(args, opts) {
        super(args, Object.assign({ fromBlueprint: true }, opts)); // fromBlueprint variable is important

        const jhContext = (this.jhipsterContext = opts.jhipsterContext);

        if (!jhContext) {
            this.error(
                `This is a JHipster blueprint and should be used only like ${chalk.yellow('jhipster --blueprint composite-key-server')}`
            );
        }

        this.configOptions = jhContext.configOptions || {};
        if (jhContext.databaseType === 'cassandra') {
            this.error("cassandra doesn't support composite keys");
        }
    }

    get writing() {
        /**
         * Any method beginning with _ can be reused from the superclass `EntityServerGenerator`
         *
         * There are multiple ways to customize a phase from JHipster.
         *
         * 1. Let JHipster handle a phase, blueprint doesnt override anything.
         * ```
         *      return super._writing();
         * ```
         *
         * 2. Override the entire phase, this is when the blueprint takes control of a phase
         * ```
         *      return {
         *          myCustomWritePhaseStep() {
         *              // Do all your stuff here
         *          },
         *          myAnotherCustomWritePhaseStep(){
         *              // Do all your stuff here
         *          }
         *      };
         * ```
         *
         * 3. Partially override a phase, this is when the blueprint gets the phase from JHipster and customizes it.
         * ```
         *      const phaseFromJHipster = super._writing();
         *      const myCustomPhaseSteps = {
         *          writeClientFiles() {
         *              // override the writeClientFiles method from the _writing phase of JHipster
         *          },
         *          myCustomInitPhaseStep() {
         *              // Do all your stuff here
         *          },
         *      }
         *      return Object.assign(phaseFromJHipster, myCustomPhaseSteps);
         * ```
         */
        const prePhaseSteps = {
            // making sure name is unique to not override any step
            compositeKeyServerConfiguration() {
                const context = this;
                this._computePkData(context);
                if (context.pkData.length === 1) {
                    context.pkType = context.pkData[0].type;
                    context.pkName = context.pkData[0].name;
                } else {
                    context.pkType = `${context.entityClass}Id`;
                    context.pkName = 'id';
                }
                context.pkData.forEach(pk => {
                    pk.nameCapitalized = _.upperFirst(pk.name);
                    pk.columnName = _.snakeCase(pk.name);
                    pk.getter = (pk.type === 'Boolean' ? 'is' : 'get') + pk.nameCapitalized;
                    pk.setter = `set${pk.nameCapitalized}`;
                });
            },

            compositeKeyServerLoadFieldsInrelationship() {
                this.relationships.forEach(r => {
                    const otherContext = this._getEntityJson(r.otherEntityNameCapitalized);
                    r.fields = otherContext.fields;
                    if (r.pkData.length === 1 && r.pkData[0].name === 'id' && r.pkData[0].type === 'Long') {
                        r.fields.unshift(defaultIdField);
                    }
                    r.relationships = otherContext.relationships;
                });
            }
        };
        const phaseFromJHipster = super._writing();
        const customPhaseSteps = {
            writeServerFiles() {
                // override the writeServerFiles method from the _writing phase of JHipster
                writeFiles().writeServerFiles.call(this);
            },

            writeEnumFiles() {
                // override the writeEnumFiles method from the _writing phase of JHipster
                writeFiles().writeEnumFiles.call(this);
            }
        };
        return Object.assign(prePhaseSteps, phaseFromJHipster, customPhaseSteps);
    }

    _loadRelationshipPkData(entityName, currentContext) {
        const context = this._getEntityJson(entityName);
        this._computePkData(context, currentContext);
        return context.pkData;
    }

    _computePkData(context, previousContext) {
        if (!context.fields.some(x => x.options && x.options.id) && !context.relationships.some(r => this._checkRelationshipPartOfId(r))) {
            context.fields.unshift(defaultIdField);
        }
        context.pkData = [];
        for (let i = 0; i < context.fields.length; i++) {
            const field = context.fields[i];
            if (field.options && field.options.id) {
                field.partOfId = true;
                context.pkData.push({
                    // To load field like javadoc, validation... for DTO
                    ...field,
                    name: field.fieldName,
                    type: field.fieldType,
                    entityName: context.name,
                    field
                });
            }
        }
        // TODO handle cyclic references specially in criteria
        for (let i = 0; i < context.relationships.length; i++) {
            const relationship = context.relationships[i];
            if (previousContext && previousContext.name === _.upperFirst(relationship.otherEntityName)) {
                relationship.pkData = previousContext.pkData;
            } else {
                relationship.pkData = this._loadRelationshipPkData(relationship.otherEntityName, context);
                if (!relationship.otherEntityField || relationship.otherEntityField === 'id') {
                    relationship.otherEntityField = relationship.pkData[0].name;
                }
                relationship.pkData.forEach(pk => {
                    pk.nameCapitalized = _.upperFirst(pk.name);
                    pk.fieldValidate = relationship.relationshipValidateRules === 'required';
                    pk.fieldValidateRules = pk.fieldValidate ? ['required'] : [];
                    pk.otherEntityNameCapitalized = relationship.otherEntityNameCapitalized;
                    pk.nameHumanized = _.startCase(context.relationshipNameHumanized);
                    pk.formName = relationship.relationshipName + (pk.formName ? _.upperFirst(pk.formName) : '');
                    // if two ids are created using fields we might need to check here if so this is done only once, I personally don't see any real use case for this
                    if (!pk.otherEntityField) {
                        pk.otherEntityField = relationship.otherEntityField;
                    }
                    if (!pk.otherEntityFieldDTOSource) {
                        pk.otherEntityFieldDTOSource = pk.otherEntityField;
                    }
                    pk.otherEntityFieldDTOSource = `${relationship.relationshipName}.${pk.otherEntityFieldDTOSource}`;
                });
            }
            if (relationship.options && relationship.options.id && relationship.relationshipType === 'many-to-one') {
                relationship.partOfId = true;
                context.pkData.push(
                    ...relationship.pkData.map(pk => {
                        // there might be a more complicate logic required here, that takes into account, both if the relationship is required, and if the fields of the if of the relationship are
                        // but for now we just set it to required if the relationship is required
                        // set as an array and use fieldValidateRules to have the same code in DTO both if pk is a field in the current entity or comes from a relationship
                        const name = relationship.relationshipName + _.upperFirst(pk.name);
                        return {
                            ...pk,
                            name,
                            nameCapitalized: _.upperFirst(name),
                            relationship
                        };
                    })
                );
            }
        }
    }

    _checkRelationshipPartOfId(relationship) {
        return relationship.options && relationship.options.id && relationship.relationshipType === 'many-to-one';
    }

    _getEntityJson(file) {
        let entityJson = null;

        try {
            if (this.microservicePath) {
                entityJson = this.fs.readJSON(path.join(this.microservicePath, JHIPSTER_CONFIG_DIR, `${_.upperFirst(file)}.json`));
            } else {
                entityJson = this.fs.readJSON(path.join(JHIPSTER_CONFIG_DIR, `${_.upperFirst(file)}.json`));
            }
        } catch (err) {
            this.log(chalk.red(`The JHipster entity configuration file could not be read for file ${file}!`) + err);
            this.debug('Error:', err);
        }

        return entityJson;
    }
};
