/**
 * DogCard —— spec 3.2.3,恰好 5 个 key,一个都不能多。
 * 任何面向其他用户的狗展示(公园看板、约遛)都必须过这里,
 * 狗文档里的 ownerOpenid / breed / tagCode 等一律不外泄。只此一份,别在函数里再抄。
 *
 * @param {object} dog  dogs 文档
 * @returns {{dogId:string,name:string,avatarFileID:string,sizeClass:string,tags:string[]}}
 */
function toDogCard(dog) {
  return {
    dogId: dog._id,
    name: dog.name || '',
    avatarFileID: dog.avatarFileID || '',
    sizeClass: dog.sizeClass || '',
    tags: Array.isArray(dog.tags) ? dog.tags.slice() : [],
  };
}

module.exports = { toDogCard };
