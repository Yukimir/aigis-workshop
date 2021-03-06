import * as mongoose from 'mongoose';
import * as crypto from 'crypto';
import { CreateSectionDto, CreateCommitDto, CreateFileDto, StoreKeys } from '../dto/assets.dto';
import { ObjectId } from 'bson';
import { SectionStatus, Constants } from '../../constants';
import { Section, Commit, SectionModel, FileModel, File } from '../interface/assets.interface';

function generateHash(texts: Array<string>): string {
    const md5 = crypto.createHash('md5');
    texts.forEach(t => md5.update(t));
    return md5.digest('hex');
}

export const FileSchema = new mongoose.Schema({
    name: String,
    assetsPath: String,
    type: Number,
    lastUpdated: {
        type: Number,
        default: null,
    },
    translated: {
        type: Number,
        default: 0,
    },
    corrected: {
        type: Number,
        default: 0,
    },
    polished: {
        type: Number,
        default: 0,
    },
    sections: [{
        type: String,
    }],
    contractors: [{
        user: mongoose.Schema.Types.ObjectId,
        count: Number,
    }],
});

FileSchema.index({ name: 1 }, { unique: true });

FileSchema.statics.createFile = async function (this: FileModel, file: CreateFileDto, force?: boolean) {
    let doc = await this.findOne({ name: file.name }).exec();
    if (doc === null) doc = new this(file);
    doc.lastUpdated = (new Date()).getTime();
    doc.assetsPath = file.assetsPath;
    try {
        await doc.save();
        return doc;
    } catch (err) {
        return null;
    }
};

FileSchema.methods.getPublishedText = async function (this: File) {
    const texts = [];
    for (const hash of this.sections) {
        const doc = await this.model('section').findOne({ hash }).exec() as any as Section;
        if (doc.publishedCommit) {
            const commit = doc.commits.id(doc.publishedCommit);
            if (commit) texts.push(commit.text);
        }
    }
    return texts;
};

FileSchema.methods.mergeSections = async function (this: File, sections: Array<CreateSectionDto>) {
    this.lastUpdated = (new Date()).getTime();
    let count = 0;
    for (const sectionDto of sections) {
        // 尝试加入section
        let add = false;
        if (!sectionDto.hash) {
            sectionDto.hash = generateHash([sectionDto.originText, sectionDto.desc]);
        }
        let section = await (this.model('section') as any as SectionModel).hasSection(sectionDto.hash);
        if (!section) {
            section = await (this.model('section') as any as SectionModel).createSection(sectionDto);
            if (!section) {
                // console.log('迷之重复错误', sectionDto.originText);
                return;
            }
            add = true;
        } else {
            if (!this.sections.find(v => sectionDto.hash === v)) {
                add = true;
            }
        }
        if (add) {
            this.sections.push(section.hash);
            if (section.status >= 1) this.translated++;
            if (section.status >= 2) this.corrected++;
            if (section.status >= 3) this.polished++;
            count++;
            // section那边加上文件的信息，保证同步
            section.parent.push(this._id);
            await section.save();
        }
    }
    await this.save();
    return count;
};

FileSchema.methods.contractSections = async function (this: File, user: ObjectId, count: number) {
    let result = 0;
    for (const hash of this.sections) {
        if (count <= 0) break;
        const section = await this.model('section').findOne({ hash }).exec() as any as Section;
        if (!section) { throw Constants.NO_SPECIFIED_SECTION; } // ????
        if (!section.contractInfo) {
            await section.contract(user);
            count--; result++;
        }
    }
    let contractor = this.contractors.find(v => {
        return user.toHexString() === v.user.toHexString();
    });
    if (!contractor) {
        contractor = {
            user,
            count: result,
        };
        this.contractors.push(contractor);
    } else {
        contractor.count += result;
    }
    await this.save();
    return this;
};

FileSchema.methods.getContractedSections = async function (this: File, user: ObjectId) {
    const sections: Section[] = [];
    for (const hash of this.sections) {
        const section = await this.model('section').findOne({ hash }).exec() as any as Section;
        if (!section) { throw Constants.NO_SPECIFIED_SECTION; } // ????
        if (section.verifyContractor(user)) sections.push(section);
    }
    return sections;

    // TODO: 只返回没翻译过的
};

FileSchema.methods.getSections = async function (this: File, start: number, count: number) {
    const sectionDocs = [];
    const end = count !== 0 ? start + count : undefined;
    const sections = start && end ? this.sections.splice(start, end) : this.sections;
    for (const hash of sections) {
        const section = await this.model('section').findOne({ hash }).exec() as any as Section;
        if (!section) { throw Constants.NO_SPECIFIED_SECTION; } // ???
        sectionDocs.push(section);
    }
    return sectionDocs;
};